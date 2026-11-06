/**
 * Vitest setup: the upstream tool tests exercise write tools end to end, and
 * the server is read-only unless write tools are enabled. Enable them for the
 * test process so those tests keep running unmodified.
 *
 * Tests of the policy itself (src/security/*.test.ts) never rely on this:
 * they pass an explicit policy or environment object.
 */
process.env.CW_MANAGE_WRITE_TOOLS ??= "*";
