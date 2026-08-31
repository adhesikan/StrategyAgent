import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const entrypoints = [
  "scripts/enrich-institutional-security-references.ts",
  "scripts/analyze-institutional-coverage.ts",
  "scripts/verify-institutional-security-type-state.ts",
];

describe("institutional CLI entrypoint lifecycle", () => {
  for (const path of entrypoints) {
    it(`${path} uses deferred exit status and closes the pool`, () => {
      const source = readFileSync(path, "utf8");
      expect(source).toContain("void runCli(main");
      expect(source).toContain("process.exitCode = exitCode");
      expect(source).toContain("close: () => pool.end()");
      expect(source).not.toContain("process.exit(");
    });
  }

  it("projects security_master.asset_type into analyzer classifications", () => {
    const source = readFileSync("scripts/analyze-institutional-coverage.ts", "utf8");
    expect(source).toContain("s.asset_type,s.master_evidence");
    expect(source).toContain("canonicalSecurityTypeStateQuery");
    expect(source).toContain("canonicalReconciliation");
  });
});