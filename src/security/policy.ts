/**
 * Server-side access policy.
 *
 * Everything here is enforced in code (tool registration + the API client),
 * never by tool descriptions or instructions to the model. Defaults are the
 * restrictive ones: a server started with no policy variables is read-only.
 *
 * Environment variables:
 *   CW_MANAGE_WRITE_TOOLS            Comma-separated write tools to enable, or "*".
 *                                    Default: none (read-only server).
 *   CW_MANAGE_DISABLED_TOOLS         Comma-separated tools (read or write) that are
 *                                    never registered. Default: none.
 *   CW_MANAGE_ALLOWED_COMPANY_IDS    Comma-separated ConnectWise company record IDs
 *                                    the connector may read or write. Default:
 *                                    unset = no company restriction.
 *   CW_MANAGE_INCLUDE_INTERNAL_NOTES "true" to return internal-analysis notes.
 *                                    Default: false (internal notes are dropped).
 *   CW_MANAGE_EXTRA_FIELDS           Comma-separated "resource.field" additions to
 *                                    the built-in field allowlist, e.g.
 *                                    "timeEntry.customFields".
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { RESOURCES, NEVER_RETURNED } from "./resources.js";

/**
 * Every tool that issues a POST, PATCH or DELETE.
 *
 * This list only decides which tools are hidden by default. It is not what
 * stops a write: the guarded client refuses every non-GET request that is not
 * made from inside an enabled tool on this list, so a write tool that is
 * missing here (for example one added upstream later) cannot write at all
 * until it is added.
 */
export const WRITE_TOOLS: ReadonlySet<string> = new Set([
  "cw_add_adjustment_detail",
  "cw_add_project_ticket_note",
  "cw_add_ticket_note",
  "cw_close_adjustment",
  "cw_create_activity",
  "cw_create_adjustment",
  "cw_create_agreement_addition",
  "cw_create_catalog_item",
  "cw_create_company",
  "cw_create_contact",
  "cw_create_project",
  "cw_create_schedule_entry",
  "cw_create_ticket",
  "cw_create_ticket_task",
  "cw_create_time_entry",
  "cw_delete_schedule_entry",
  "cw_delete_time_entry",
  "cw_update_agreement_addition",
  "cw_update_catalog_item",
  "cw_update_company",
  "cw_update_contact",
  "cw_update_contact_types",
  "cw_update_invoice",
  "cw_update_project_ticket",
  "cw_update_schedule_entry",
  "cw_update_ticket",
  "cw_update_ticket_configurations",
  "cw_update_ticket_task",
  "cw_update_time_entry",
]);

export interface AccessPolicy {
  /** Write tools that may be registered and may issue non-GET requests. */
  readonly writeTools: ReadonlySet<string>;
  /** Tools (read or write) that are never registered. */
  readonly disabledTools: ReadonlySet<string>;
  /** Approved company record IDs, or null when no restriction is configured. */
  readonly allowedCompanyIds: ReadonlySet<number> | null;
  readonly includeInternalNotes: boolean;
  /** resource name -> extra top-level fields the operator has allowed. */
  readonly extraFields: ReadonlyMap<string, ReadonlySet<string>>;
}

/** Thrown when policy configuration is invalid. Startup must fail on this. */
export class PolicyConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyConfigError";
  }
}

/** Thrown when a request is refused by policy. The message is safe to return. */
export class PolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyError";
  }
}

type EnvLike = Record<string, string | undefined>;

function csv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function loadAccessPolicy(env: EnvLike = process.env): AccessPolicy {
  // --- write tools ---------------------------------------------------------
  const writeNames = csv(env.CW_MANAGE_WRITE_TOOLS);
  let writeTools: Set<string>;
  if (writeNames.includes("*")) {
    if (writeNames.length > 1) {
      throw new PolicyConfigError(
        'CW_MANAGE_WRITE_TOOLS: "*" cannot be combined with tool names',
      );
    }
    writeTools = new Set(WRITE_TOOLS);
  } else {
    const unknown = writeNames.filter((n) => !WRITE_TOOLS.has(n));
    if (unknown.length) {
      throw new PolicyConfigError(
        `CW_MANAGE_WRITE_TOOLS names unknown write tools: ${unknown.join(", ")}`,
      );
    }
    writeTools = new Set(writeNames);
  }

  // --- disabled tools ------------------------------------------------------
  const disabledTools = new Set(csv(env.CW_MANAGE_DISABLED_TOOLS));
  for (const name of disabledTools) {
    if (!/^cw_[a-z0-9_]+$/.test(name)) {
      throw new PolicyConfigError(
        `CW_MANAGE_DISABLED_TOOLS entry "${name}" is not a tool name`,
      );
    }
    if (writeTools.has(name) && !writeNames.includes("*")) {
      throw new PolicyConfigError(
        `"${name}" is listed in both CW_MANAGE_WRITE_TOOLS and CW_MANAGE_DISABLED_TOOLS`,
      );
    }
    writeTools.delete(name);
  }

  // --- company scope -------------------------------------------------------
  let allowedCompanyIds: Set<number> | null = null;
  if (env.CW_MANAGE_ALLOWED_COMPANY_IDS !== undefined) {
    const ids = csv(env.CW_MANAGE_ALLOWED_COMPANY_IDS);
    // Set-but-empty must not silently mean "everything".
    if (!ids.length) {
      throw new PolicyConfigError(
        "CW_MANAGE_ALLOWED_COMPANY_IDS is set but empty; list company IDs or unset it",
      );
    }
    allowedCompanyIds = new Set();
    for (const raw of ids) {
      if (!/^\d{1,9}$/.test(raw) || Number(raw) <= 0) {
        throw new PolicyConfigError(
          `CW_MANAGE_ALLOWED_COMPANY_IDS contains a non-numeric ID: "${raw}"`,
        );
      }
      allowedCompanyIds.add(Number(raw));
    }
  }

  // --- extra fields --------------------------------------------------------
  const extraFields = new Map<string, Set<string>>();
  for (const entry of csv(env.CW_MANAGE_EXTRA_FIELDS)) {
    const m = /^([A-Za-z]+)\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(entry);
    if (!m) {
      throw new PolicyConfigError(
        `CW_MANAGE_EXTRA_FIELDS entry "${entry}" must look like resource.field`,
      );
    }
    const [, resource, field] = m as unknown as [string, string, string];
    if (!(resource in RESOURCES)) {
      throw new PolicyConfigError(
        `CW_MANAGE_EXTRA_FIELDS names unknown resource "${resource}". Known: ${Object.keys(RESOURCES).join(", ")}`,
      );
    }
    if (NEVER_RETURNED.has(field)) {
      throw new PolicyConfigError(
        `CW_MANAGE_EXTRA_FIELDS: field "${field}" can never be returned`,
      );
    }
    if (!extraFields.has(resource)) extraFields.set(resource, new Set());
    extraFields.get(resource)!.add(field);
  }

  const flag = env.CW_MANAGE_INCLUDE_INTERNAL_NOTES;
  if (flag !== undefined && flag !== "true" && flag !== "false") {
    throw new PolicyConfigError(
      'CW_MANAGE_INCLUDE_INTERNAL_NOTES must be "true" or "false"',
    );
  }

  return {
    writeTools,
    disabledTools,
    allowedCompanyIds,
    includeInternalNotes: flag === "true",
    extraFields,
  };
}

/** One-line, secret-free description of the active policy for the startup log. */
export function describePolicy(policy: AccessPolicy): string {
  const writes = policy.writeTools.size
    ? `${policy.writeTools.size}/${WRITE_TOOLS.size} write tools enabled`
    : "read-only";
  const scope = policy.allowedCompanyIds
    ? `company scope: ${policy.allowedCompanyIds.size} approved`
    : "company scope: UNRESTRICTED (set CW_MANAGE_ALLOWED_COMPANY_IDS to restrict)";
  const disabled = policy.disabledTools.size ? `; ${policy.disabledTools.size} tools disabled` : "";
  return `[policy] ${writes}${disabled}; ${scope}; internal notes ${policy.includeInternalNotes ? "included" : "excluded"}`;
}

// ---------------------------------------------------------------------------
// Per-call context: which tool is running, and may it write?
// ---------------------------------------------------------------------------

export interface ToolContext {
  tool: string;
  /** True only for a declared write tool that the policy has enabled. */
  mayWrite: boolean;
}

export const toolContext = new AsyncLocalStorage<ToolContext>();
