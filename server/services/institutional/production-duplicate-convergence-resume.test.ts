import { describe, expect, it, vi } from "vitest";
import {
  getConvergenceJournalConsistencyIssues,
  resumeConvergenceMaterialization,
  type ConvergenceJournalRecord,
  type ConvergenceJournalStore,
} from "./production-duplicate-convergence";

function journal(overrides: Partial<ConvergenceJournalRecord> = {}): ConvergenceJournalRecord {
  return {
    id: "run-1",
    planHash: "a".repeat(64),
    status: "MUTATION_COMMITTED",
    canonicalAccessions: ["000000000126000001"],
    affectedPeriods: ["2026-03-31"],
    affectedSymbols: ["ABC", "XYZ"],
    targets: [
      { symbol: "ABC", periodOfReport: "2026-03-31" },
      { symbol: "XYZ", periodOfReport: "2025-12-31" },
    ],
    mutationCompleted: true,
    materializationCompleted: false,
    lastCompletedStage: "EFFECTIVENESS_RECOMPUTED",
    completedAggregateTargets: [],
    completedSignalSymbols: [],
    failureStage: null,
    failureReason: null,
    attemptCount: 0,
    activeAttemptId: "attempt-1",
    leaseExpiresAt: "2026-09-02T20:00:00.000Z",
    createdAt: "2026-09-02T19:00:00.000Z",
    updatedAt: "2026-09-02T19:00:00.000Z",
    ...overrides,
  };
}

function memoryStore(initial: ConvergenceJournalRecord) {
  let value = structuredClone(initial);
  const store: ConvergenceJournalStore = {
    create: vi.fn(async () => value),
    update: vi.fn(async (_id, patch) => {
      value = { ...value, ...patch, updatedAt: new Date().toISOString() };
      return structuredClone(value);
    }),
  };
  return { store, get: () => value };
}

function dependencies() {
  return {
    recomputeAggregate: vi.fn(async () => undefined),
    rebuildSignal: vi.fn(async () => undefined),
    refreshSnapshots: vi.fn(async () => undefined),
  };
}

describe("durable duplicate convergence materialization resume", () => {
  it("resumes exact persisted targets after restart and completes all stages", async () => {
    const initial = journal();
    const memory = memoryStore(initial);
    const deps = dependencies();
    const result = await resumeConvergenceMaterialization(initial, memory.store, deps);
    expect(deps.recomputeAggregate.mock.calls).toEqual([
      ["ABC", "2026-03-31", "2025-12-31"],
      ["XYZ", "2025-12-31", "2025-09-30"],
    ]);
    expect(deps.rebuildSignal.mock.calls).toEqual([["ABC"], ["XYZ"]]);
    expect(result).toMatchObject({ status: "COMPLETED", materializationCompleted: true });
  });

  it("aggregate failure checkpoints retryable state and resumes aggregate plus remaining stages", async () => {
    const initial = journal();
    const memory = memoryStore(initial);
    const failing = dependencies();
    failing.recomputeAggregate
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("aggregate failed at https://secret.example/path"));
    await expect(resumeConvergenceMaterialization(initial, memory.store, failing))
      .rejects.toThrow("aggregate failed");
    const checkpoint = memory.get();
    expect(checkpoint).toMatchObject({
      status: "FAILED_RETRYABLE",
      failureStage: "AGGREGATES",
      completedAggregateTargets: ["ABC:2026-03-31"],
    });
    expect(checkpoint.failureReason).not.toContain("secret.example");

    const resumedStore = memoryStore(checkpoint);
    const resumed = dependencies();
    await resumeConvergenceMaterialization(checkpoint, resumedStore.store, resumed);
    expect(resumed.recomputeAggregate).toHaveBeenCalledTimes(1);
    expect(resumed.recomputeAggregate).toHaveBeenCalledWith("XYZ", "2025-12-31", "2025-09-30");
  });

  it("signal failure resumes at the failed signal without repeating aggregates or completed signals", async () => {
    const initial = journal({
      status: "FAILED_RETRYABLE",
      lastCompletedStage: "SIGNALS",
      completedAggregateTargets: ["ABC:2026-03-31", "XYZ:2025-12-31"],
      completedSignalSymbols: ["ABC"],
      failureStage: "SIGNALS",
    });
    const memory = memoryStore(initial);
    const deps = dependencies();
    await resumeConvergenceMaterialization(initial, memory.store, deps);
    expect(deps.recomputeAggregate).not.toHaveBeenCalled();
    expect(deps.rebuildSignal.mock.calls).toEqual([["XYZ"]]);
  });

  it("is idempotent after completion", async () => {
    const initial = journal({
      status: "COMPLETED",
      materializationCompleted: true,
      lastCompletedStage: "SNAPSHOTS",
      activeAttemptId: null,
      leaseExpiresAt: null,
    });
    const memory = memoryStore(initial);
    const deps = dependencies();
    expect(await resumeConvergenceMaterialization(initial, memory.store, deps)).toEqual(initial);
    expect(memory.store.update).not.toHaveBeenCalled();
    expect(deps.refreshSnapshots).not.toHaveBeenCalled();
  });

  it("fails closed when mutation was not durably committed", async () => {
    const initial = journal({ status: "MUTATION_IN_PROGRESS", mutationCompleted: false });
    const memory = memoryStore(initial);
    await expect(resumeConvergenceMaterialization(initial, memory.store, dependencies()))
      .rejects.toThrow("CONVERGENCE_MUTATION_NOT_COMMITTED");
  });

  it("rejects inconsistent persisted scope and completion flags", () => {
    const inconsistent = journal({
      status: "COMPLETED",
      materializationCompleted: false,
      targets: [
        { symbol: "abc", periodOfReport: "2026-03-31" },
        { symbol: "abc", periodOfReport: "2026-03-31" },
      ],
      completedAggregateTargets: ["MISSING:2026-03-31"],
    });
    expect(getConvergenceJournalConsistencyIssues(inconsistent)).toEqual(
      expect.arrayContaining([
        "INVALID_TARGET_SCOPE",
        "UNKNOWN_COMPLETED_AGGREGATE_TARGET",
        "COMPLETED_FLAGS_INVALID",
      ]),
    );
  });
});