/**
 * End to end through the MCP protocol: which tools a client can see and call
 * under each policy, and that the Worker entry point applies the same policy.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../mcp-server.js";
import worker from "../worker.js";
import { loadAccessPolicy, WRITE_TOOLS } from "./policy.js";

const CONFIG = {
  baseUrl: "https://api-na.myconnectwise.net",
  companyId: "testco",
  publicKey: "pub",
  privateKey: "priv",
  clientId: "client",
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(
    async () =>
      new Response(
        JSON.stringify({ id: 1, summary: "Printer", text: "ok", customFields: [{ value: "hidden" }] }),
        { status: 200 },
      ),
  );
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function connect(env: Record<string, string> = {}) {
  const server = createMcpServer(CONFIG, loadAccessPolicy(env));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientTransport);
  return client;
}

async function toolNames(env: Record<string, string> = {}): Promise<string[]> {
  return (await (await connect(env)).listTools()).tools.map((tool) => tool.name);
}

function text(result: unknown): string {
  return ((result as { content?: { text?: string }[] }).content ?? [])
    .map((part) => part.text ?? "")
    .join("\n");
}

describe("tool exposure", () => {
  it("is read-only by default: no write tool is listed", async () => {
    const names = await toolNames();
    expect(names).toContain("cw_search_tickets");
    expect(names.filter((name) => WRITE_TOOLS.has(name))).toEqual([]);
    // Nothing that looks like a write slipped past the declared list.
    expect(names.filter((name) => /^cw_(create|update|add|delete|close)_/.test(name))).toEqual([]);
  });

  it("lists exactly the write tools that are enabled", async () => {
    const names = await toolNames({ CW_MANAGE_WRITE_TOOLS: "cw_add_ticket_note,cw_create_time_entry" });
    expect(names.filter((name) => WRITE_TOOLS.has(name)).sort()).toEqual([
      "cw_add_ticket_note",
      "cw_create_time_entry",
    ]);
  });

  it("knows every write tool the server registers, and names none that do not exist", async () => {
    const all = await toolNames({ CW_MANAGE_WRITE_TOOLS: "*" });
    const readOnly = await toolNames();
    // Every declared write tool is a real tool.
    expect([...WRITE_TOOLS].filter((name) => !all.includes(name))).toEqual([]);
    // The only difference between the two servers is the declared write list.
    expect(all.filter((name) => !readOnly.includes(name)).sort()).toEqual([...WRITE_TOOLS].sort());
  });

  it("does not register a disabled tool, read or write", async () => {
    const names = await toolNames({
      CW_MANAGE_WRITE_TOOLS: "*",
      CW_MANAGE_DISABLED_TOOLS: "cw_search_invoices,cw_update_invoice",
    });
    expect(names).not.toContain("cw_search_invoices");
    expect(names).not.toContain("cw_update_invoice");
    expect(names).toContain("cw_get_invoice");
  });
});

describe("tool calls", () => {
  it("rejects a call to a disabled write tool and sends nothing to ConnectWise", async () => {
    const client = await connect();
    const result = await client
      .callTool({ name: "cw_create_ticket", arguments: { summary: "x", boardId: 1, companyId: 1 } })
      .catch((err: Error) => ({ isError: true, content: [{ text: err.message }] }));
    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(text(result)).toMatch(/not found|disabled/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns only allowlisted fields from a read tool", async () => {
    const client = await connect();
    const result = await client.callTool({ name: "cw_get_ticket", arguments: { id: 1 } });
    expect(text(result)).toContain("Printer");
    expect(text(result)).not.toContain("customFields");
    expect(text(result)).not.toContain("hidden");
  });

  it("lets an enabled write tool write", async () => {
    const client = await connect({ CW_MANAGE_WRITE_TOOLS: "cw_update_ticket" });
    const result = await client.callTool({
      name: "cw_update_ticket",
      arguments: { id: 1, operations: [{ op: "replace", path: "summary", value: "New" }] },
    });
    expect((result as { isError?: boolean }).isError).not.toBe(true);
    const methods = fetchMock.mock.calls.map((call) => (call[1] as RequestInit).method);
    expect(methods).toContain("PATCH");
  });

  it("applies the company restriction to a tool call", async () => {
    const client = await connect({ CW_MANAGE_ALLOWED_COMPANY_IDS: "10" });
    fetchMock.mockImplementation(
      async () =>
        new Response(JSON.stringify({ id: 2, summary: "Theirs", company: { id: 99 } }), { status: 200 }),
    );
    const result = await client.callTool({ name: "cw_get_ticket", arguments: { id: 2 } });
    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(text(result)).toContain("Record not found");
    expect(text(result)).not.toContain("Theirs");
  });
});

describe("Cloudflare Worker entry point", () => {
  const headers = {
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
    "X-CW-Company-Id": "acme",
    "X-CW-Public-Key": "pub",
    "X-CW-Private-Key": "priv",
    "X-CW-Client-Id": "client-guid",
  };

  function listTools(env: Record<string, string>): Promise<Response> {
    return worker.fetch(
      new Request("http://worker.local/mcp", {
        method: "POST",
        headers,
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      }),
      { AUTH_MODE: "gateway", ...env },
    );
  }

  it("takes the policy from the Worker's own variables", async () => {
    const res = await listTools({ CW_MANAGE_WRITE_TOOLS: "" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { tools: { name: string }[] } };
    const names = body.result.tools.map((tool) => tool.name);
    expect(names).toContain("cw_search_tickets");
    expect(names.filter((name) => WRITE_TOOLS.has(name))).toEqual([]);
  });

  it("disables /mcp instead of serving with an invalid policy", async () => {
    const res = await listTools({ CW_MANAGE_ALLOWED_COMPANY_IDS: "" });
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toContain("cw_");
  });
});
