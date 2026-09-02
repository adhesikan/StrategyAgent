import { describe, expect, it, vi } from "vitest";
import {
  applyDuplicateConvergence, buildDuplicateConvergencePlan, DUPLICATE_CONVERGENCE_CONFIRMATION,
  getDuplicateConvergenceApplyGuardIssues, type DuplicateGroup,
} from "./production-duplicate-convergence";

const accession = "000000000126000001";
const authoritative = { canonicalAccession: accession, filerCik: "0000000001", filingDate: "2026-05-15", periodOfReport: "2026-03-31", filingType: "13F-HR", amendmentFlag: false };
function group(conflict = false): DuplicateGroup {
  const rows = ["a", "b"].map((id, n) => ({ id, rawAccession: n ? "0000000001-26-000001" : accession, filerCik: authoritative.filerCik, filingDate: authoritative.filingDate, periodOfReport: authoritative.periodOfReport, filingType: "13F-HR", amendmentFlag: false, isEffective: true }));
  return { canonicalAccession: accession, rows, authoritative, symbols: ["ABC"], fingerprints: new Map([[rows[0].rawAccession, { count: 1, digest: "one" }], [rows[1].rawAccession, { count: 1, digest: conflict ? "two" : "one" }]]) };
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
  it("validates replay before deleting legacy and is transactionally resumable", async () => {
    const plan = buildDuplicateConvergencePlan([group(true)], "APPLY");
    const events: string[] = [];
    const executor: any = { transaction: async (fn: any) => fn(executor), execute: vi.fn(async (query: any) => events.push(String(query))) };
    await applyDuplicateConvergence(executor, plan, { replay: async () => events.push("validated-and-inserted"), materialize: async () => undefined });
    expect(events[1]).toBe("validated-and-inserted");
  });
  it("fails before writes when in-transaction population changed", async () => {
    const plan = buildDuplicateConvergencePlan([group()], "APPLY");
    const execute = vi.fn();
    await expect(applyDuplicateConvergence({ execute, transaction: async fn => fn({ execute }) }, plan, {
      replay: async () => undefined, materialize: async () => undefined, revalidatePlan: async () => "changed",
    })).rejects.toThrow("STALE_PLAN_HASH");
    expect(execute).toHaveBeenCalledTimes(1);
  });
});