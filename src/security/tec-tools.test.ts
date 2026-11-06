/**
 * The TEC additions on top of the upstream tool set: each one is registered,
 * calls the ConnectWise endpoint it should, and obeys the access policy.
 *
 * Deliberately NOT added here, because upstream covers or will cover them:
 * opportunity create/update, activity lookups, a single-entry schedule GET
 * (use cw_search_schedule_entries with conditions "id = <id>"), and Pay Code
 * on create (set it afterwards with cw_update_time_entry on `customFields`).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../mcp-server.js";
import { loadAccessPolicy, WRITE_TOOLS } from "./policy.js";

const CONFIG = {
  baseUrl: "https://api-na.myconnectwise.net",
  companyId: "testco",
  publicKey: "pub",
  privateKey: "priv",
  clientId: "client",
};

const API_PREFIX = "/v4_6_release/apis/3.0";

const READ_TOOLS = [
  "cw_get_ticket_tasks",
  "cw_list_board_types",
  "cw_list_board_subtypes",
  "cw_list_board_items",
  "cw_list_work_types",
  "cw_list_work_roles",
  "cw_list_schedule_calendars",
  "cw_list_schedule_holidays",
];

const TEC_WRITE_TOOLS = [
  "cw_create_ticket_task",
  "cw_update_ticket_task",
  "cw_update_project_ticket",
  "cw_delete_schedule_entry",
];

const DROPPED = [
  "cw_create_opportunity",
  "cw_update_opportunity",
  "cw_list_activity_types",
  "cw_list_activity_statuses",
  "cw_get_schedule_entry",
];

let requests: { method: string; path: string; body: unknown }[];

beforeEach(() => {
  requests = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      requests.push({
        method,
        path: new URL(input).pathname.slice(API_PREFIX.length),
        body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      });
      if (method === "DELETE") return new Response(null, { status: 204 });
      const record = { id: 7, notes: "Check toner", name: "Break/Fix", summary: "Rack install" };
      return new Response(JSON.stringify(method === "GET" ? [record] : record), { status: 200 });
    }),
  );
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

async function run(env: Record<string, string>, name: string, args: Record<string, unknown>) {
  const client = await connect(env);
  const result = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content: { text: string }[];
  };
  return { result, sent: requests.map((r) => `${r.method} ${r.path}`) };
}

describe("TEC tool set", () => {
  it("registers the read tools on a default (read-only) server and hides the write tools", async () => {
    const names = (await (await connect()).listTools()).tools.map((tool) => tool.name);
    for (const name of READ_TOOLS) expect(names).toContain(name);
    for (const name of TEC_WRITE_TOOLS) expect(names).not.toContain(name);
  });

  it("declares every TEC write tool to the policy", () => {
    for (const name of TEC_WRITE_TOOLS) expect(WRITE_TOOLS.has(name)).toBe(true);
  });

  it("does not carry the tools that were left to upstream", async () => {
    const names = (await (await connect({ CW_MANAGE_WRITE_TOOLS: "*" })).listTools()).tools.map(
      (tool) => tool.name,
    );
    for (const name of DROPPED) expect(names).not.toContain(name);
  });
});

describe("TEC read tools call the right endpoint", () => {
  const cases: [string, Record<string, unknown>, string][] = [
    ["cw_get_ticket_tasks", { id: 12 }, "GET /service/tickets/12/tasks"],
    ["cw_list_board_types", { boardId: 3 }, "GET /service/boards/3/types"],
    ["cw_list_board_subtypes", { boardId: 3 }, "GET /service/boards/3/subtypes"],
    ["cw_list_board_items", { boardId: 3 }, "GET /service/boards/3/items"],
    ["cw_list_work_types", {}, "GET /time/workTypes"],
    ["cw_list_work_roles", {}, "GET /time/workRoles"],
    ["cw_list_schedule_calendars", {}, "GET /schedule/calendars"],
    ["cw_list_schedule_holidays", {}, "GET /schedule/holidays"],
  ];

  it.each(cases)("%s", async (name, args, expected) => {
    const { result, sent } = await run({}, name, args);
    expect(result.isError).not.toBe(true);
    expect(sent).toEqual([expected]);
    expect(JSON.parse(result.content[0]!.text)).toHaveLength(1);
  });
});

describe("TEC write tools", () => {
  const cases: [string, Record<string, unknown>, string][] = [
    ["cw_create_ticket_task", { id: 12, notes: "Check toner" }, "POST /service/tickets/12/tasks"],
    [
      "cw_update_ticket_task",
      { ticketId: 12, taskId: 4, operations: [{ op: "replace", path: "closedFlag", value: true }] },
      "PATCH /service/tickets/12/tasks/4",
    ],
    [
      "cw_update_project_ticket",
      { id: 30, operations: [{ op: "replace", path: "status/id", value: 5 }] },
      "PATCH /project/tickets/30",
    ],
    ["cw_delete_schedule_entry", { id: 88 }, "DELETE /schedule/entries/88"],
  ];

  it.each(cases)("%s writes when it is enabled", async (name, args, expected) => {
    const { result, sent } = await run({ CW_MANAGE_WRITE_TOOLS: name }, name, args);
    expect(result.isError).not.toBe(true);
    expect(sent).toEqual([expected]);
  });

  it.each(cases)("%s is unavailable on a read-only server", async (name, args) => {
    const client = await connect();
    const outcome = await client
      .callTool({ name, arguments: args })
      .then((r) => r as { isError?: boolean })
      .catch(() => ({ isError: true }));
    expect(outcome.isError).toBe(true);
    expect(requests).toEqual([]);
  });

  it("confirms a deleted schedule entry by ID", async () => {
    const { result } = await run({ CW_MANAGE_WRITE_TOOLS: "cw_delete_schedule_entry" }, "cw_delete_schedule_entry", { id: 88 });
    expect(JSON.parse(result.content[0]!.text)).toEqual({ id: 88, deleted: true });
  });
});

describe("Pay Code uses the upstream tools", () => {
  it("is set on an existing time entry with a customFields patch", async () => {
    const operations = [{ op: "replace", path: "customFields", value: [{ id: 19, value: "Regular" }] }];
    const { result, sent } = await run({ CW_MANAGE_WRITE_TOOLS: "cw_update_time_entry" }, "cw_update_time_entry", {
      id: 500,
      operations,
    });
    expect(result.isError).not.toBe(true);
    expect(sent).toEqual(["PATCH /time/entries/500"]);
    expect(requests[0]!.body).toEqual(operations);
  });
});
