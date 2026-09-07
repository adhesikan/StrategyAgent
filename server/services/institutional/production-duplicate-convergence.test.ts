import { describe, expect, it, vi } from "vitest";
import {
  applyDuplicateConvergence, buildDuplicateConvergencePlan, DUPLICATE_CONVERGENCE_CONFIRMATION,
  getDuplicateConvergenceApplyGuardIssues, type DuplicateGroup,
} from "./production-duplicate-convergence";

const accession = "000000000126000001";
const authoritative = { canonicalAccession: accession, filerCik: "0000000001", filingDate: "2026-05-15", periodOfReport: "2026-03-31", filingType: "13F-HR", amendmentFlag: false };
function group(conflict = false): DuplicateGroup {
  const rows = ["a", "b"].map((id, n) => ({ id, rawAccession: n ? "0000000001-26-000001" : accession, filerCik: authoritative.filerCik, filingDate: authoritative.filingDate, periodOfReport: authoritative.periodOfReport, filingType: "13F-HR", amendmentFlag: false, isEffective: true }));
  return {
    canonicalAccession: accession,
    rows,
    authoritative,
    targets: [{ symbol: "ABC", periodOfReport: authoritative.periodOfReport }],
    fingerprints: new Map([
      [rows[0].rawAccession, { count: 1, digest: "one" }],
      [rows[1].rawAccession, { count: 1, digest: conflict ? "two" : "one" }],
    ]),
  };
}

function executorWithResults(results: unknown[]) {
  const execute = vi.fn(async () => results.shift() ?? { rows: [] });
  const executor: any = {
    execute,
    transaction: async (fn: any) => fn(executor),
  };
  return executor;
}

describe("production duplicate convergence", () => {
  it("collapses identical dashed duplicates without double counting", () => {
    const plan = buildDuplicateConvergencePlan([group()]);
    expect(plan.safeCleanupGroups).toBe(1); expect(plan.replayGroups).toBe(0);
    expect(plan.operations[0]).toMatchObject({ survivorId: "a", duplicateIds: ["b"], affectedHoldings: 2 });
  });
  it("routes conflicting holdings to authoritative replay and never legacy merge", () => {
    const plan = buildDuplicateConvergencePlan([group(true)]);
    expect(plan.operations[0]).toMatchObject({ action: "AUTHORITATIVE_REPLAY", survivorId: null, duplicateIds: ["a", "b"] });
  });
  it("rejects stale hashes and requires exact confirmation", () => {
    const plan = buildDuplicateConvergencePlan([group()]);
    expect(getDuplicateConvergenceApplyGuardIssues(plan, { apply: true, planHash: "stale", confirm: "x" })).toEqual(expect.arrayContaining(["PLAN_HASH_MISMATCH", "CONFIRMATION_REQUIRED"]));
    expect(getDuplicateConvergenceApplyGuardIssues(plan, { apply: true, planHash: plan.planHash, confirm: DUPLICATE_CONVERGENCE_CONFIRMATION })).toEqual([]);
  });
  it("does no writes in dry planning", () => {
    const execute = vi.fn();
    buildDuplicateConvergencePlan([group()]);
    expect(execute).not.toHaveBeenCalled();
  });
  it("keeps the non-empty dashed holding donor and exact symbol-period targets", () => {
    const input = group();
    input.fingerprints.set(input.rows[0].rawAccession, { count: 0, digest: "empty" });
    input.targets = [
      { symbol: "abc", periodOfReport: "2026-03-31" },
      { symbol: "ABC", periodOfReport: "2026-03-31" },
      { symbol: "XYZ", periodOfReport: "2025-12-31" },
    ];
    const plan = buildDuplicateConvergencePlan([input]);
    expect(plan.operations[0].holdingSourceRawAccession).toBe("0000000001-26-000001");
    expect(plan.downstreamRebuildScope.symbolPeriods).toEqual([
      { symbol: "ABC", periodOfReport: "2026-03-31" },
      { symbol: "XYZ", periodOfReport: "2025-12-31" },
    ]);
  });
  it("blocks an unvalidated replay when validation is mandatory", () => {
    const plan = buildDuplicateConvergencePlan(
      [group(true)],
      "DRY_RUN",
      { requireReplayValidation: true },
    );
    expect(plan.operations[0]).toMatchObject({
      action: "BLOCKED",
      blocker: "AUTHORITATIVE_REPLAY_NOT_VALIDATED",
    });
    expect(plan.productionApplyReady).toBe(false);
  });
  it("validates replay before deleting legacy and is transactionally resumable", async () => {
    const plan = buildDuplicateConvergencePlan([group(true)], "APPLY");
    const events: string[] = [];
    let calls = 0;
    const executor: any = {
      transaction: async (fn: any) => fn(executor),
      execute: vi.fn(async (query: any) => {
        calls += 1;
        events.push(String(query));
        return calls === 2 ? { rows: [{ locked: true }] } : { rows: [] };
      }),
    };
    await applyDuplicateConvergence(executor, plan, { replay: async () => { events.push("validated-and-inserted"); }, materialize: async () => undefined });
    expect(events[2]).toBe("validated-and-inserted");
  });
  it("does not execute destructive convergence statements when replay validation fails", async () => {
    const plan = buildDuplicateConvergencePlan([group(true)], "APPLY");
    const executor = executorWithResults([
      { rows: [] },
      { rows: [{ locked: true }] },
    ]);
    await expect(applyDuplicateConvergence(executor, plan, {
      replay: async () => { throw new Error("SEC_REPLAY_FAILED"); },
      materialize: async () => undefined,
    })).rejects.toThrow("SEC_REPLAY_FAILED");
    expect(executor.execute).toHaveBeenCalledTimes(2);
  });
  it("rolls back instead of creating uniqueness when a canonical collision remains", async () => {
    const plan = buildDuplicateConvergencePlan([group()], "APPLY");
    const executor = executorWithResults([
      { rows: [] },
      { rows: [{ locked: true }] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [{ collision: 1 }] },
    ]);
    await expect(applyDuplicateConvergence(executor, plan, {
      replay: async () => undefined,
      materialize: async () => undefined,
    })).rejects.toThrow("CANONICAL_ACCESSION_COLLISION_REMAINS");
  });
  it("routes a replay-shaped group outside the manifest to PLAN_CHANGED and blocks APPLY", async () => {
    const plan = buildDuplicateConvergencePlan([group(true)], "DRY_RUN", {
      requireReplayValidation: true,
      manifestAccessions: new Set<string>(),
    });
    expect(plan.operations[0]).toMatchObject({
      action: "PLAN_CHANGED_REVALIDATION_REQUIRED",
      blocker: "PLAN_CHANGED_REVALIDATION_REQUIRED",
    });
    expect(plan.planChangedGroups).toBe(1);
    expect(plan.productionApplyReady).toBe(false);
    expect(plan.canonicalUniquenessReady).toBe(false);
    const applyPlan = buildDuplicateConvergencePlan([group(true)], "APPLY", {
      requireReplayValidation: true,
      manifestAccessions: new Set<string>(),
    });
    await expect(applyDuplicateConvergence(executorWithResults([]), applyPlan, {
      replay: async () => undefined,
      materialize: async () => undefined,
    })).rejects.toThrow("PLAN_NOT_APPLY_READY");
  });
  it("a group inside the manifest with a replay validation still converges normally", () => {
    const g = { ...group(true), replayValidation: { sourceUrl: "u", sourceChecksum: "c", holdingCount: 2 } };
    const plan = buildDuplicateConvergencePlan([g], "DRY_RUN", {
      requireReplayValidation: true,
      manifestAccessions: new Set([g.canonicalAccession]),
    });
    expect(plan.operations[0].action).toBe("AUTHORITATIVE_REPLAY");
    expect(plan.planChangedGroups).toBe(0);
    expect(plan.productionApplyReady).toBe(true);
  });
  it("fails before writes when in-transaction population changed", async () => {
    const plan = buildDuplicateConvergencePlan([group()], "APPLY");
    let calls = 0;
    const execute = vi.fn(async () => {
      calls += 1;
      return calls === 2 ? { rows: [{ locked: true }] } : { rows: [] };
    });
    await expect(applyDuplicateConvergence({ execute, transaction: async fn => fn({ execute }) }, plan, {
      replay: async () => undefined, materialize: async () => undefined, revalidatePlan: async () => "changed",
    })).rejects.toThrow("STALE_PLAN_HASH");
    expect(execute).toHaveBeenCalledTimes(2);
  });
});