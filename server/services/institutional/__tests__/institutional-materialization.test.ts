import { describe, expect, it, vi } from "vitest";
import { materializeAffectedInstitutionalTargets } from "../ingestion-service";

function dependencies(events: string[]) {
  return {
    recomputeAggregate: vi.fn(async (symbol: string, period: string) => {
      events.push(`aggregate:${symbol}:${period}`);
    }),
    rebuildSignal: vi.fn(async (symbol: string) => {
      events.push(`signal:${symbol}`);
      return {} as any;
    }),
    refreshSnapshots: vi.fn(async () => {
      events.push("snapshots");
      return {} as any;
    }),
  };
}

describe("institutional affected-target materialization", () => {
  it("carries a security-master-only promotion target through all downstream stages", async () => {
    const events: string[] = [];
    const deps = dependencies(events);
    await expect(materializeAffectedInstitutionalTargets([
      { symbol: "NVDA", periodOfReport: "2026-06-30" },
      // Multiple trusted CUSIPs collapse to this same symbol-period target.
      { symbol: "NVDA", periodOfReport: "2026-06-30" },
    ], { dependencies: deps })).resolves.toEqual({
      symbols: ["NVDA"],
      failedTargets: [],
    });

    expect(deps.recomputeAggregate).toHaveBeenCalledWith(
      "NVDA",
      "2026-06-30",
      "2026-03-31",
    );
    expect(deps.recomputeAggregate).toHaveBeenCalledTimes(1);
    expect(deps.rebuildSignal).toHaveBeenCalledOnce();
    expect(deps.refreshSnapshots).toHaveBeenCalledOnce();
    expect(events).toEqual([
      "aggregate:NVDA:2026-06-30",
      "signal:NVDA",
      "snapshots",
    ]);
  });

  it("runs unresolved cleanup before stale signal and snapshot cleanup", async () => {
    const events: string[] = [];
    const deps = dependencies(events);
    // Reconciliation emits former symbol-periods for unresolved/conflicting
    // CUSIPs. recomputeAggregate deletes the stale aggregate; rebuildSignal
    // then deletes stale numeric signal state when no aggregate remains.
    await materializeAffectedInstitutionalTargets([
      { symbol: "NVDA", periodOfReport: "2026-06-30" },
      { symbol: "AMD", periodOfReport: "2026-06-30" },
    ], { dependencies: deps });

    expect(events).toEqual([
      "aggregate:NVDA:2026-06-30",
      "aggregate:AMD:2026-06-30",
      "signal:NVDA",
      "signal:AMD",
      "snapshots",
    ]);
    expect(deps.refreshSnapshots).toHaveBeenCalledTimes(1);
  });

  it("does not refresh snapshots when reconciliation has no affected symbols", async () => {
    const deps = dependencies([]);
    await expect(materializeAffectedInstitutionalTargets([], {
      dependencies: deps,
    })).resolves.toEqual({ symbols: [], failedTargets: [] });
    expect(deps.recomputeAggregate).not.toHaveBeenCalled();
    expect(deps.rebuildSignal).not.toHaveBeenCalled();
    expect(deps.refreshSnapshots).not.toHaveBeenCalled();
  });

  it("fails closed before all signal and snapshot work when any aggregate fails", async () => {
    const events: string[] = [];
    const deps = dependencies(events);
    deps.recomputeAggregate
      .mockImplementationOnce(async () => {
        events.push("aggregate:NVDA:failed");
        throw new Error("aggregate write failed");
      })
      .mockImplementationOnce(async () => {
        events.push("aggregate:AMD:success");
      });
    const onAggregateError = vi.fn();

    await expect(materializeAffectedInstitutionalTargets([
      { symbol: "NVDA", periodOfReport: "2026-06-30" },
      { symbol: "AMD", periodOfReport: "2026-06-30" },
    ], {
      dependencies: deps,
      onAggregateError,
    })).rejects.toMatchObject({
      name: "InstitutionalMaterializationError",
      failedTargets: [{
        symbol: "NVDA",
        periodOfReport: "2026-06-30",
        error: "aggregate write failed",
      }],
    });
    expect(onAggregateError).toHaveBeenCalledOnce();
    expect(deps.rebuildSignal).not.toHaveBeenCalled();
    expect(deps.refreshSnapshots).not.toHaveBeenCalled();
    expect(events).toEqual([
      "aggregate:NVDA:failed",
      "aggregate:AMD:success",
    ]);
  });
});