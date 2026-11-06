/**
 * Tool gating.
 *
 * `applyToolPolicy` is called on a fresh McpServer before any tool is
 * registered. From then on:
 *  - a tool the policy disables (a write tool that is not enabled, or any
 *    tool named in CW_MANAGE_DISABLED_TOOLS) is never registered, so it does
 *    not appear in `tools/list` and cannot be called;
 *  - every other tool runs inside a context that names it, which is what the
 *    guarded client reads to decide whether a write may be sent.
 *
 * Both registration styles used by the tool modules are covered:
 * `server.tool(...)` and `server.registerTool(...)`.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WRITE_TOOLS, toolContext, type AccessPolicy, type ToolContext } from "./policy.js";

type AnyFn = (...args: unknown[]) => unknown;

/** Stand-in for the handle a registration returns when the tool is skipped. */
const SKIPPED_TOOL = Object.freeze({
  enabled: false,
  enable() {},
  disable() {},
  update() {},
  remove() {},
});

/** True when the policy lets this tool be registered at all. */
export function isToolEnabled(name: string, policy: AccessPolicy): boolean {
  if (policy.disabledTools.has(name)) return false;
  return !WRITE_TOOLS.has(name) || policy.writeTools.has(name);
}

export function applyToolPolicy(server: McpServer, policy: AccessPolicy): void {
  const target = server as unknown as Record<"tool" | "registerTool", AnyFn>;

  for (const method of ["tool", "registerTool"] as const) {
    const original = target[method].bind(server);

    target[method] = (...args: unknown[]) => {
      const name = args[0];
      const handlerIndex = args.length - 1;
      const handler = args[handlerIndex];
      if (typeof name !== "string" || typeof handler !== "function") {
        throw new TypeError("Tool registration needs a name and a handler");
      }
      if (!isToolEnabled(name, policy)) return SKIPPED_TOOL;

      const context: ToolContext = {
        tool: name,
        mayWrite: policy.writeTools.has(name),
      };
      const wrapped = [...args];
      wrapped[handlerIndex] = (...handlerArgs: unknown[]) =>
        toolContext.run(context, () => (handler as AnyFn)(...handlerArgs));
      return original(...wrapped);
    };
  }
}
