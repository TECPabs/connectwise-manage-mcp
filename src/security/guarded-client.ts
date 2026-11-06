/**
 * Policy-enforcing ConnectWise client.
 *
 * `GuardedCwManageClient` is the only client the tools are given. It extends
 * the transport client and overrides `request()` (which `get`, `post`,
 * `patch` and `delete` all go through), so every call a tool makes passes the
 * checks below. The transport itself — authentication, TLS, the gateway URL
 * guard, safe errors — is inherited unchanged from `CwManageClient`.
 *
 * On every request:
 *  1. Route allowlist: a path that is not in the resource map is refused.
 *  2. Write gate: a non-GET request is refused unless it is made from inside
 *     a write tool that the policy has enabled.
 *  3. Company scope (when CW_MANAGE_ALLOWED_COMPANY_IDS is set): searches are
 *     narrowed upstream and re-checked row by row; direct record-ID lookups
 *     are checked against the record's company; sub-resources are checked
 *     through their parent record; writes are checked before they are sent.
 *     An out-of-scope record is reported exactly like a missing one.
 *  4. Response filter: internal notes are dropped and every record is reduced
 *     to the field allowlist of its resource.
 *
 * None of this depends on tool descriptions or on instructions to the model.
 */

import { CwManageClient, hasApiStatus, type CwManageConfig } from "../api-client.js";
import { PolicyError, toolContext, type AccessPolicy } from "./policy.js";
import {
  RESOURCES,
  companyIdOf,
  filterFields,
  matchRoute,
  type ResourceDef,
  type Route,
} from "./resources.js";

type Params = Record<string, string | number | undefined>;
type RequestOptions = { body?: unknown; params?: Params };

/** Deliberately identical for "does not exist" and "exists but is out of scope". */
export const NOT_FOUND_OR_DENIED =
  "Record not found, or not within this connector's approved company scope";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class GuardedCwManageClient extends CwManageClient {
  private readonly policy: AccessPolicy;

  constructor(config: CwManageConfig, policy: AccessPolicy) {
    super(config);
    this.policy = policy;
  }

  override async request<T = unknown>(
    method: string,
    path: string,
    options?: RequestOptions,
  ): Promise<T> {
    const verb = method.toUpperCase();
    const route = matchRoute(path);
    if (!route) {
      throw new PolicyError("This API path is not permitted by the connector");
    }

    // --- writes: only from inside an enabled write tool --------------------
    if (verb !== "GET") {
      const ctx = toolContext.getStore();
      if (!ctx?.mayWrite || !this.policy.writeTools.has(ctx.tool)) {
        throw new PolicyError("Write operations are disabled by server policy");
      }
    }

    // --- company scope -----------------------------------------------------
    const scoped =
      this.policy.allowedCompanyIds !== null && route.def.scope !== "reference";
    const checkRows = scoped && (!route.parent || route.rowScope);
    let params = options?.params;

    if (scoped) {
      if (route.def.scope === "unscoped") {
        throw new PolicyError(
          "This record type cannot be limited to approved companies and is unavailable while a company restriction is active",
        );
      }
      if (route.parent) {
        // Sub-resource: the parent record decides.
        await this.assertRecordInScope(
          route.parent.path,
          RESOURCES[route.parent.resource]!,
        );
        if (route.resource === "ticketConfiguration" && verb === "POST") {
          await this.assertAttachedConfigurationInScope(options?.body);
        }
      } else if (route.isItem) {
        if (verb !== "GET") {
          await this.assertRecordInScope(path, route.def);
          if (verb === "PATCH") this.assertPatchKeepsScope(options?.body, route.def);
        }
      } else if (verb === "GET") {
        params = {
          ...params,
          conditions: this.scopeConditions(
            route.def,
            params?.conditions === undefined ? undefined : String(params.conditions),
          ),
        };
      } else {
        await this.assertCreateInScope(route, options?.body);
      }
      if (checkRows && verb === "GET") {
        params = this.keepScopeField(params, route.def);
      }
    }

    let result: unknown;
    try {
      result = await super.request<unknown>(verb, path, {
        body: options?.body,
        params,
      });
    } catch (err) {
      // For a sub-resource the parent was already verified, so a 404 there is
      // about the endpoint itself and is reported as-is.
      if (scoped && !route.parent && hasApiStatus(err, 403, 404)) {
        throw new PolicyError(NOT_FOUND_OR_DENIED);
      }
      throw err;
    }

    if (result === undefined || result === null) return undefined as T;

    // --- response: scope re-check, internal notes, field allowlist ---------
    const dropInternal = !this.policy.includeInternalNotes;

    if (Array.isArray(result)) {
      return result
        .filter(
          (row) =>
            (!checkRows || this.inScope(row, route.def)) &&
            !(dropInternal && this.isInternalNote(row, route.def)),
        )
        .map((row) => this.filterRecord(row, route))
        .filter((row) => row !== undefined) as T;
    }

    if (checkRows && !this.inScope(result, route.def)) {
      throw new PolicyError(NOT_FOUND_OR_DENIED);
    }
    if (dropInternal && verb === "GET" && this.isInternalNote(result, route.def)) {
      throw new PolicyError(NOT_FOUND_OR_DENIED);
    }
    return this.filterRecord(result, route) as T;
  }

  // -------------------------------------------------------------------------
  // Policy helpers
  // -------------------------------------------------------------------------

  private inScope(record: unknown, def: ResourceDef): boolean {
    const allowed = this.policy.allowedCompanyIds;
    if (!allowed) return true;
    const id = companyIdOf(record, def);
    return id !== undefined && allowed.has(id);
  }

  /** Fetch a record purely to check its company. The record itself is never returned. */
  private async assertRecordInScope(path: string, def: ResourceDef): Promise<void> {
    let record: unknown;
    try {
      record = await super.request<unknown>("GET", path);
    } catch (err) {
      // Do not reveal whether an out-of-scope ID exists.
      if (hasApiStatus(err, 403, 404)) throw new PolicyError(NOT_FOUND_OR_DENIED);
      throw err;
    }
    if (!this.inScope(record, def)) throw new PolicyError(NOT_FOUND_OR_DENIED);
  }

  /** A configuration attached to a ticket must itself belong to an approved company. */
  private async assertAttachedConfigurationInScope(body: unknown): Promise<void> {
    const id = isRecord(body) ? body.id : undefined;
    if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) {
      throw new PolicyError(NOT_FOUND_OR_DENIED);
    }
    await this.assertRecordInScope(
      `/company/configurations/${id}`,
      RESOURCES.configuration!,
    );
  }

  /** The company a new record would belong to must be approved before it is created. */
  private async assertCreateInScope(route: Route, body: unknown): Promise<void> {
    const allowed = this.policy.allowedCompanyIds!;
    const record = isRecord(body) ? body : {};

    if (route.resource === "company") {
      throw new PolicyError(
        "Creating companies is not permitted while a company restriction is active",
      );
    }

    const explicit = companyIdOf(record, { scope: "company", fields: {} });
    if (explicit !== undefined) {
      if (!allowed.has(explicit)) throw new PolicyError(NOT_FOUND_OR_DENIED);
      return;
    }

    // Time entries are usually charged to a ticket rather than naming a company.
    if (route.resource === "timeEntry" && typeof record.chargeToId === "number") {
      const parentPath =
        record.chargeToType === "ServiceTicket"
          ? `/service/tickets/${record.chargeToId}`
          : record.chargeToType === "ProjectTicket"
            ? `/project/tickets/${record.chargeToId}`
            : undefined;
      if (parentPath) {
        await this.assertRecordInScope(parentPath, RESOURCES.ticket!);
        return;
      }
    }

    throw new PolicyError(
      "A company restriction is active: this record must name an approved company by its numeric ID",
    );
  }

  /** A JSON Patch must not move a record to a company outside the approved set. */
  private assertPatchKeepsScope(body: unknown, def: ResourceDef): void {
    const allowed = this.policy.allowedCompanyIds!;
    const field = (def.companyField ?? "company").toLowerCase();
    if (field === "." || !Array.isArray(body)) return;
    for (const op of body as Array<{ path?: unknown; value?: unknown }>) {
      // ConnectWise matches patch paths without regard to case.
      const path = String(op?.path ?? "").replace(/^\/+/, "").toLowerCase();
      if (path !== field && !path.startsWith(`${field}/`)) continue;
      const value = op.value;
      const id = typeof value === "number" ? value : isRecord(value) ? value.id : undefined;
      if (typeof id !== "number" || !allowed.has(id)) {
        throw new PolicyError(NOT_FOUND_OR_DENIED);
      }
    }
  }

  private scopeConditions(def: ResourceDef, conditions: string | undefined): string {
    const ids = [...this.policy.allowedCompanyIds!].join(",");
    const field = (def.companyField ?? "company") === "." ? "id" : "company/id";
    const scope = `${field} in (${ids})`;
    // Narrowing only: results are re-checked row by row, so a crafted
    // `conditions` string cannot widen what is returned.
    return conditions ? `(${conditions}) and ${scope}` : scope;
  }

  /**
   * A caller-supplied `fields` list must not hide the company the scope check
   * reads, or every row would look out of scope.
   */
  private keepScopeField(params: Params | undefined, def: ResourceDef): Params | undefined {
    const fields = params?.fields;
    if (typeof fields !== "string" || fields.trim() === "") return params;
    const needed = (def.companyField ?? "company") === "." ? "id" : "company";
    const listed = fields.split(",").map((f) => f.trim().toLowerCase());
    if (listed.includes(needed)) return params;
    return { ...params, fields: `${fields},${needed}` };
  }

  private filterRecord(record: unknown, route: Route): unknown {
    if (!isRecord(record)) return undefined;
    return filterFields(
      record,
      route.def.fields,
      this.policy.extraFields.get(route.resource),
    );
  }

  private isInternalNote(record: unknown, def: ResourceDef): boolean {
    if (!def.internalFlags || !isRecord(record)) return false;
    return def.internalFlags.some((flag) => record[flag] === true);
  }
}
