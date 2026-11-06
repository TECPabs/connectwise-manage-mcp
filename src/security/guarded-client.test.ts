/**
 * GuardedCwManageClient: the checks every tool request passes through.
 * `fetch` is mocked; nothing here reaches a real ConnectWise instance.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GuardedCwManageClient, NOT_FOUND_OR_DENIED } from "./guarded-client.js";
import { loadAccessPolicy, PolicyError, toolContext, type AccessPolicy } from "./policy.js";

const CONFIG = {
  baseUrl: "https://api-na.myconnectwise.net",
  companyId: "testco",
  publicKey: "pub-key-value",
  privateKey: "priv-key-value",
  clientId: "client-guid",
};

const API_PREFIX = "/v4_6_release/apis/3.0";

interface Call {
  method: string;
  path: string;
  params: URLSearchParams;
  body: unknown;
}

type Handler = (call: Call) => unknown;

let calls: Call[];
let handler: Handler;

/** A handler may return a body (200), `undefined` (204) or `{ __status, body }`. */
function status(code: number, body: unknown = { message: "upstream said no" }) {
  return { __status: code, body };
}

beforeEach(() => {
  calls = [];
  handler = () => ({});
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      const call: Call = {
        method: init?.method ?? "GET",
        path: url.pathname.slice(API_PREFIX.length),
        params: url.searchParams,
        body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      };
      calls.push(call);
      const out = handler(call);
      if (out === undefined) return new Response(null, { status: 204 });
      if (typeof out === "object" && out !== null && "__status" in out) {
        const { __status, body } = out as { __status: number; body: unknown };
        return new Response(JSON.stringify(body), { status: __status });
      }
      return new Response(JSON.stringify(out), { status: 200 });
    }),
  );
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function clientFor(env: Record<string, string> = {}): { client: GuardedCwManageClient; policy: AccessPolicy } {
  const policy = loadAccessPolicy(env);
  return { client: new GuardedCwManageClient(CONFIG, policy), policy };
}

/** Run `fn` the way tool-policy.ts runs a tool handler. */
function asTool<T>(tool: string, policy: AccessPolicy, fn: () => Promise<T>): Promise<T> {
  return toolContext.run({ tool, mayWrite: policy.writeTools.has(tool) }, fn);
}

const sent = () => calls.map((c) => `${c.method} ${c.path}`);

// ---------------------------------------------------------------------------

describe("route allowlist", () => {
  it("refuses a path that is not in the resource map, without calling ConnectWise", async () => {
    const { client } = clientFor();
    for (const path of [
      "/system/apiMembers",
      "/system/members/1/../../info",
      "/company/companies/1/notes",
      "/service/tickets/1?fields=customFields",
      "/service/tickets/abc",
      "/expense/entries",
    ]) {
      await expect(client.get(path)).rejects.toThrow(/not permitted/);
    }
    expect(calls).toEqual([]);
  });
});

describe("write gate", () => {
  it("refuses every non-GET request made outside a tool", async () => {
    const { client } = clientFor({ CW_MANAGE_WRITE_TOOLS: "*" });
    await expect(client.post("/service/tickets", { summary: "x" })).rejects.toThrow(PolicyError);
    await expect(client.patch("/service/tickets/1", [])).rejects.toThrow(/disabled by server policy/);
    await expect(client.delete("/time/entries/1")).rejects.toThrow(PolicyError);
    expect(calls).toEqual([]);
  });

  it("refuses a write from a read tool and from a write tool that is not enabled", async () => {
    const { client, policy } = clientFor({ CW_MANAGE_WRITE_TOOLS: "cw_add_ticket_note" });
    await expect(
      asTool("cw_search_tickets", policy, () => client.post("/service/tickets", { summary: "x" })),
    ).rejects.toThrow(/disabled by server policy/);
    await expect(
      asTool("cw_create_ticket", policy, () => client.post("/service/tickets", { summary: "x" })),
    ).rejects.toThrow(/disabled by server policy/);
    expect(calls).toEqual([]);
  });

  it("does not trust a context that claims write access for a tool the policy has not enabled", async () => {
    const { client } = clientFor();
    await expect(
      toolContext.run({ tool: "cw_create_ticket", mayWrite: true }, () =>
        client.post("/service/tickets", { summary: "x" }),
      ),
    ).rejects.toThrow(/disabled by server policy/);
    expect(calls).toEqual([]);
  });

  it("sends the write from an enabled write tool", async () => {
    const { client, policy } = clientFor({ CW_MANAGE_WRITE_TOOLS: "cw_add_ticket_note" });
    handler = () => ({ id: 5, text: "hello" });
    const result = await asTool("cw_add_ticket_note", policy, () =>
      client.post("/service/tickets/7/notes", { text: "hello" }),
    );
    expect(result).toEqual({ id: 5, text: "hello" });
    expect(sent()).toEqual(["POST /service/tickets/7/notes"]);
  });

  it("still allows reads on a read-only server", async () => {
    const { client } = clientFor();
    handler = () => [{ id: 1, summary: "Printer" }];
    await expect(client.get("/service/tickets")).resolves.toEqual([{ id: 1, summary: "Printer" }]);
  });
});

describe("field allowlist", () => {
  it("returns only allowlisted fields, on single records and on lists", async () => {
    const { client } = clientFor();
    const ticket = {
      id: 1,
      summary: "Printer",
      company: { id: 10, identifier: "ACME", name: "Acme", _info: { company_href: "https://x" } },
      customFields: [{ id: 19, caption: "Pay Code", value: "Regular" }],
      initialInternalAnalysis: "customer is behind on payments",
      automaticEmailCc: "boss@acme.example",
      _info: { lastUpdated: "2026-01-01", updatedBy: "jdoe", notes_href: "https://x" },
    };
    const expected = {
      id: 1,
      summary: "Printer",
      company: { id: 10, identifier: "ACME", name: "Acme" },
      _info: { lastUpdated: "2026-01-01", updatedBy: "jdoe" },
    };
    handler = (call) => (call.path === "/service/tickets" ? [ticket] : ticket);
    await expect(client.get("/service/tickets/1")).resolves.toEqual(expected);
    await expect(client.get("/service/tickets")).resolves.toEqual([expected]);
  });

  it("drops configuration details and member personal data by default", async () => {
    const { client } = clientFor();
    handler = (call) =>
      call.path.startsWith("/company/configurations")
        ? {
            id: 3,
            name: "FW-01",
            serialNumber: "SN1",
            ipAddress: "10.1.2.3",
            defaultGateway: "10.1.2.1",
            macAddress: "aa:bb",
            notes: "admin / hunter2",
            questions: [{ question: "Admin password", answer: "hunter2" }],
            customFields: [{ value: "x" }],
          }
        : {
            id: 9,
            identifier: "jdoe",
            firstName: "Jane",
            lastName: "Doe",
            homeEmail: "j@home.example",
            mobilePhone: "555-0100",
            hourlyCost: 40,
            hourlyRate: 150,
            dateOfBirth: "1990-01-01",
            password: "secret",
          };
    await expect(client.get("/company/configurations/3")).resolves.toEqual({
      id: 3,
      name: "FW-01",
      serialNumber: "SN1",
    });
    await expect(client.get("/system/members/9")).resolves.toEqual({
      id: 9,
      identifier: "jdoe",
      firstName: "Jane",
      lastName: "Doe",
    });
  });

  it("adds a field only when the operator opts in, and never a credential", async () => {
    handler = () => ({
      id: 1,
      notes: "work",
      customFields: [{ id: 19, caption: "Pay Code", value: "Regular", password: "nope" }],
      hourlyRate: 150,
    });
    await expect(clientFor().client.get("/time/entries/1")).resolves.toEqual({ id: 1, notes: "work" });
    const { client } = clientFor({ CW_MANAGE_EXTRA_FIELDS: "timeEntry.customFields" });
    await expect(client.get("/time/entries/1")).resolves.toEqual({
      id: 1,
      notes: "work",
      customFields: [{ id: 19, caption: "Pay Code", value: "Regular" }],
    });
  });

  it("filters the record a write returns", async () => {
    const { client, policy } = clientFor({ CW_MANAGE_WRITE_TOOLS: "cw_update_ticket" });
    handler = () => ({ id: 1, summary: "New", customFields: [{ value: "x" }] });
    const result = await asTool("cw_update_ticket", policy, () =>
      client.patch("/service/tickets/1", [{ op: "replace", path: "summary", value: "New" }]),
    );
    expect(result).toEqual({ id: 1, summary: "New" });
  });

  it("returns nothing for a response that is not a record", async () => {
    const { client } = clientFor();
    handler = () => "plain text from upstream";
    await expect(client.get("/system/info")).resolves.toBeUndefined();
  });
});

describe("internal notes", () => {
  const notes = [
    { id: 1, text: "Replaced toner", detailDescriptionFlag: true },
    { id: 2, text: "Customer disputes invoice", internalAnalysisFlag: true },
    { id: 3, text: "Private", internalFlag: true },
  ];

  it("drops internal notes by default", async () => {
    const { client } = clientFor();
    handler = () => notes;
    const result = await client.get<{ id: number }[]>("/service/tickets/7/notes");
    expect(result.map((n) => n.id)).toEqual([1]);
  });

  it("returns them only when the operator opts in", async () => {
    const { client } = clientFor({ CW_MANAGE_INCLUDE_INTERNAL_NOTES: "true" });
    handler = () => notes;
    const result = await client.get<{ id: number }[]>("/service/tickets/7/notes");
    expect(result.map((n) => n.id)).toEqual([1, 2, 3]);
  });
});

describe("company scope", () => {
  const SCOPE = { CW_MANAGE_ALLOWED_COMPANY_IDS: "10,11" };
  const inScope = { id: 1, summary: "Ours", company: { id: 10, name: "Acme" } };
  const outOfScope = { id: 2, summary: "Theirs", company: { id: 99, name: "Other" } };

  it("narrows a search upstream and re-checks every returned row", async () => {
    const { client } = clientFor(SCOPE);
    // Upstream ignores the condition: the row check must still hold.
    handler = () => [inScope, outOfScope, { id: 3, summary: "No company" }];
    const result = await client.get("/service/tickets", { conditions: "status/name = 'Open' or id > 0" });
    expect(result).toEqual([inScope]);
    expect(calls[0]!.params.get("conditions")).toBe(
      "(status/name = 'Open' or id > 0) and company/id in (10,11)",
    );
  });

  it("scopes the company list by the company's own ID", async () => {
    const { client } = clientFor(SCOPE);
    handler = () => [{ id: 10, name: "Acme" }, { id: 99, name: "Other" }];
    await expect(client.get("/company/companies")).resolves.toEqual([{ id: 10, name: "Acme" }]);
    expect(calls[0]!.params.get("conditions")).toBe("id in (10,11)");
  });

  it("reports a direct lookup of an out-of-scope record exactly like a missing one", async () => {
    const { client } = clientFor(SCOPE);
    handler = (call) => (call.path.endsWith("/2") ? outOfScope : status(404));
    const denied = await client.get("/service/tickets/2").catch((e: Error) => e);
    const missing = await client.get("/service/tickets/404").catch((e: Error) => e);
    expect(denied).toBeInstanceOf(PolicyError);
    expect((denied as Error).message).toBe(NOT_FOUND_OR_DENIED);
    expect((missing as Error).message).toBe((denied as Error).message);
    await expect(client.get("/company/companies/99")).rejects.toThrow(NOT_FOUND_OR_DENIED);
  });

  it("returns a direct lookup of an in-scope record", async () => {
    const { client } = clientFor(SCOPE);
    handler = () => inScope;
    await expect(client.get("/service/tickets/1")).resolves.toEqual(inScope);
  });

  it("checks a sub-resource through its parent and never requests it when the parent is out of scope", async () => {
    const { client } = clientFor(SCOPE);
    handler = (call) => (call.path === "/service/tickets/2" ? outOfScope : [{ id: 1, text: "secret" }]);
    await expect(client.get("/service/tickets/2/notes")).rejects.toThrow(NOT_FOUND_OR_DENIED);
    await expect(client.get("/finance/agreements/2/additions")).rejects.toThrow(NOT_FOUND_OR_DENIED);
    expect(sent()).toEqual(["GET /service/tickets/2", "GET /finance/agreements/2"]);
  });

  it("returns a sub-resource of an in-scope parent", async () => {
    const { client } = clientFor(SCOPE);
    handler = (call) => (call.path === "/service/tickets/1" ? inScope : [{ id: 5, text: "note" }]);
    await expect(client.get("/service/tickets/1/notes")).resolves.toEqual([{ id: 5, text: "note" }]);
  });

  it("keeps the company in a caller-supplied field list so the check cannot be starved", async () => {
    const { client } = clientFor(SCOPE);
    handler = () => inScope;
    await client.get("/service/tickets/1", { fields: "automaticEmailContactFlag" });
    expect(calls[0]!.params.get("fields")).toBe("automaticEmailContactFlag,company");
  });

  it("checks a record before changing or deleting it", async () => {
    const { client, policy } = clientFor({ ...SCOPE, CW_MANAGE_WRITE_TOOLS: "*" });
    handler = () => outOfScope;
    await expect(
      asTool("cw_update_ticket", policy, () =>
        client.patch("/service/tickets/2", [{ op: "replace", path: "summary", value: "x" }]),
      ),
    ).rejects.toThrow(NOT_FOUND_OR_DENIED);
    await expect(
      asTool("cw_delete_time_entry", policy, () => client.delete("/time/entries/2")),
    ).rejects.toThrow(NOT_FOUND_OR_DENIED);
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("refuses a patch that would move a record to an unapproved company", async () => {
    const { client, policy } = clientFor({ ...SCOPE, CW_MANAGE_WRITE_TOOLS: "*" });
    handler = () => inScope;
    for (const op of [
      { op: "replace", path: "company", value: { id: 99 } },
      { op: "replace", path: "/Company/id", value: 99 },
      { op: "replace", path: "company", value: { identifier: "OTHER" } },
    ]) {
      await expect(
        asTool("cw_update_ticket", policy, () => client.patch("/service/tickets/1", [op])),
      ).rejects.toThrow(NOT_FOUND_OR_DENIED);
    }
    expect(calls.every((c) => c.method === "GET")).toBe(true);
    await expect(
      asTool("cw_update_ticket", policy, () =>
        client.patch("/service/tickets/1", [{ op: "replace", path: "company", value: { id: 11 } }]),
      ),
    ).resolves.toEqual(inScope);
  });

  it("only creates records for an approved company", async () => {
    const { client, policy } = clientFor({ ...SCOPE, CW_MANAGE_WRITE_TOOLS: "*" });
    handler = (call) => (call.method === "POST" ? { id: 50, ...(call.body as object) } : outOfScope);
    const create = (tool: string, path: string, body: unknown) =>
      asTool(tool, policy, () => client.post(path, body));

    await expect(create("cw_create_ticket", "/service/tickets", { summary: "x", company: { id: 99 } }))
      .rejects.toThrow(NOT_FOUND_OR_DENIED);
    await expect(create("cw_create_ticket", "/service/tickets", { summary: "x" }))
      .rejects.toThrow(/must name an approved company/);
    await expect(create("cw_create_ticket", "/service/tickets", { summary: "x", company: { identifier: "ACME" } }))
      .rejects.toThrow(/must name an approved company/);
    await expect(create("cw_create_company", "/company/companies", { name: "New Co" }))
      .rejects.toThrow(/Creating companies is not permitted/);
    // A time entry charged to a ticket follows that ticket's company.
    await expect(
      create("cw_create_time_entry", "/time/entries", { chargeToId: 2, chargeToType: "ServiceTicket" }),
    ).rejects.toThrow(NOT_FOUND_OR_DENIED);
    expect(calls.every((c) => c.method === "GET")).toBe(true);

    await expect(
      create("cw_create_ticket", "/service/tickets", { summary: "x", company: { id: 10 } }),
    ).resolves.toMatchObject({ id: 50, summary: "x" });
  });

  it("refuses to attach another company's configuration to an approved ticket", async () => {
    const { client, policy } = clientFor({ ...SCOPE, CW_MANAGE_WRITE_TOOLS: "*" });
    handler = (call) =>
      call.path === "/service/tickets/1" ? inScope : { id: 7, name: "Their server", company: { id: 99 } };
    await expect(
      asTool("cw_update_ticket_configurations", policy, () =>
        client.post("/service/tickets/1/configurations", { id: 7 }),
      ),
    ).rejects.toThrow(NOT_FOUND_OR_DENIED);
    expect(sent()).toEqual(["GET /service/tickets/1", "GET /company/configurations/7"]);
  });

  it("makes record types that carry no customer unavailable, and leaves reference data alone", async () => {
    const { client } = clientFor(SCOPE);
    handler = () => [{ id: 1, name: "Service" }];
    for (const path of ["/schedule/entries", "/schedule/entries/5", "/procurement/purchaseorders"]) {
      await expect(client.get(path)).rejects.toThrow(/unavailable while a company restriction is active/);
    }
    expect(calls).toEqual([]);
    await expect(client.get("/service/boards")).resolves.toEqual([{ id: 1, name: "Service" }]);
    expect(calls[0]!.params.get("conditions")).toBeNull();
  });

  it("does not restrict anything when no company list is configured", async () => {
    const { client } = clientFor();
    handler = () => [inScope, outOfScope];
    await expect(client.get("/service/tickets")).resolves.toEqual([inScope, outOfScope]);
    expect(calls[0]!.params.get("conditions")).toBeNull();
  });
});

describe("errors and logs", () => {
  it("never returns or logs the upstream body, credentials or query values", async () => {
    const { client } = clientFor();
    const logged = vi.mocked(console.error);
    handler = () =>
      status(500, {
        message: "SqlException at Db.Query line 42",
        stackTrace: "at ConnectWise.Internal...",
        record: { ssn: "000-00-0000", notes: "sensitive record contents" },
      });
    const error = (await client
      .get("/service/tickets", { conditions: "summary contains 'salary review'" })
      .catch((e: Error) => e)) as Error;

    const output = [error.message, ...logged.mock.calls.map((args) => args.join(" "))].join("\n");
    expect(error.message).toMatch(/returned 500 \(reference [0-9a-f-]{36}\)/);
    for (const secret of [
      "SqlException",
      "stackTrace",
      "sensitive record contents",
      "000-00-0000",
      "salary review",
      CONFIG.privateKey,
      CONFIG.publicKey,
      "Basic ",
    ]) {
      expect(output).not.toContain(secret);
    }
    // The one log line carries the same reference the caller was given.
    const reference = /reference ([0-9a-f-]{36})/.exec(error.message)![1]!;
    expect(output.split("\n").slice(1).join("\n")).toContain(reference);
  });

  it("reports rejected credentials by status only", async () => {
    const { client } = clientFor();
    handler = () => status(401, { code: "Unauthorized", message: "Invalid API member credentials" });
    const error = (await client.get("/system/info").catch((e: Error) => e)) as Error;
    expect(error.message).toContain("returned 401");
    expect(error.message).not.toContain(CONFIG.privateKey);
  });
});
