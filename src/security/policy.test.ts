/**
 * Access-policy configuration: restrictive defaults, and invalid settings
 * are errors rather than silently meaning "everything".
 */
import { describe, it, expect } from "vitest";
import { loadAccessPolicy, describePolicy, PolicyConfigError, WRITE_TOOLS } from "./policy.js";

describe("loadAccessPolicy", () => {
  it("is read-only and excludes internal notes when nothing is configured", () => {
    const policy = loadAccessPolicy({});
    expect(policy.writeTools.size).toBe(0);
    expect(policy.disabledTools.size).toBe(0);
    expect(policy.allowedCompanyIds).toBeNull();
    expect(policy.includeInternalNotes).toBe(false);
    expect(policy.extraFields.size).toBe(0);
    expect(describePolicy(policy)).toContain("read-only");
  });

  it("enables only the write tools that are named", () => {
    const policy = loadAccessPolicy({
      CW_MANAGE_WRITE_TOOLS: " cw_add_ticket_note , cw_create_time_entry ",
    });
    expect([...policy.writeTools].sort()).toEqual(["cw_add_ticket_note", "cw_create_time_entry"]);
  });

  it('enables every write tool for "*", and refuses "*" mixed with names', () => {
    expect(loadAccessPolicy({ CW_MANAGE_WRITE_TOOLS: "*" }).writeTools.size).toBe(WRITE_TOOLS.size);
    expect(() => loadAccessPolicy({ CW_MANAGE_WRITE_TOOLS: "*,cw_create_ticket" })).toThrow(
      PolicyConfigError,
    );
  });

  it("rejects a name that is not a known write tool", () => {
    expect(() => loadAccessPolicy({ CW_MANAGE_WRITE_TOOLS: "cw_search_tickets" })).toThrow(
      /unknown write tools: cw_search_tickets/,
    );
    expect(() => loadAccessPolicy({ CW_MANAGE_WRITE_TOOLS: "cw_drop_everything" })).toThrow(
      PolicyConfigError,
    );
  });

  it("parses approved company IDs and rejects empty or non-numeric lists", () => {
    const policy = loadAccessPolicy({ CW_MANAGE_ALLOWED_COMPANY_IDS: "10, 11" });
    expect([...policy.allowedCompanyIds!]).toEqual([10, 11]);
    // Set-but-empty must not mean "no restriction".
    expect(() => loadAccessPolicy({ CW_MANAGE_ALLOWED_COMPANY_IDS: "" })).toThrow(/set but empty/);
    expect(() => loadAccessPolicy({ CW_MANAGE_ALLOWED_COMPANY_IDS: " , " })).toThrow(PolicyConfigError);
    for (const bad of ["acme", "10;11", "-3", "0", "1 or 1=1", "*"]) {
      expect(() => loadAccessPolicy({ CW_MANAGE_ALLOWED_COMPANY_IDS: bad })).toThrow(PolicyConfigError);
    }
  });

  it("accepts extra fields only as resource.field on a known resource", () => {
    const policy = loadAccessPolicy({
      CW_MANAGE_EXTRA_FIELDS: "timeEntry.customFields, ticket.customFields",
    });
    expect(policy.extraFields.get("timeEntry")?.has("customFields")).toBe(true);
    expect(policy.extraFields.get("ticket")?.has("customFields")).toBe(true);
    for (const bad of ["customFields", "nosuch.field", "ticket.", "ticket.a.b", "ticket.*"]) {
      expect(() => loadAccessPolicy({ CW_MANAGE_EXTRA_FIELDS: bad })).toThrow(PolicyConfigError);
    }
  });

  it("never lets a credential field be added", () => {
    for (const field of ["password", "portalPassword", "privateKey", "token", "licenseBits"]) {
      expect(() => loadAccessPolicy({ CW_MANAGE_EXTRA_FIELDS: `member.${field}` })).toThrow(
        /can never be returned/,
      );
    }
  });

  it("accepts only true or false for the internal-notes switch", () => {
    expect(loadAccessPolicy({ CW_MANAGE_INCLUDE_INTERNAL_NOTES: "true" }).includeInternalNotes).toBe(true);
    expect(loadAccessPolicy({ CW_MANAGE_INCLUDE_INTERNAL_NOTES: "false" }).includeInternalNotes).toBe(false);
    expect(() => loadAccessPolicy({ CW_MANAGE_INCLUDE_INTERNAL_NOTES: "yes" })).toThrow(PolicyConfigError);
  });

  it("disables named tools, and a disabled tool wins over the write wildcard", () => {
    const policy = loadAccessPolicy({
      CW_MANAGE_WRITE_TOOLS: "*",
      CW_MANAGE_DISABLED_TOOLS: "cw_search_invoices,cw_update_invoice",
    });
    expect(policy.disabledTools.has("cw_search_invoices")).toBe(true);
    expect(policy.writeTools.has("cw_update_invoice")).toBe(false);
    expect(policy.writeTools.has("cw_update_ticket")).toBe(true);
    expect(() => loadAccessPolicy({ CW_MANAGE_DISABLED_TOOLS: "Search Tickets" })).toThrow(
      PolicyConfigError,
    );
    // Naming one tool as both enabled and disabled is a mistake, not a tie to break.
    expect(() =>
      loadAccessPolicy({
        CW_MANAGE_WRITE_TOOLS: "cw_update_ticket",
        CW_MANAGE_DISABLED_TOOLS: "cw_update_ticket",
      }),
    ).toThrow(/both/);
  });
});
