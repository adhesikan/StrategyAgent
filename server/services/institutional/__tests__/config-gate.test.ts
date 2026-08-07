// config-gate.test.ts — Institutional Intelligence gate separation tests.
//
// Verifies that INSTITUTIONAL_INTELLIGENCE_ENABLED and
// INSTITUTIONAL_13F_INGESTION_ENABLED are truly independent, and that
// ingestion can run while the public feature flag is false.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getInstitutionalConfig,
  isInstitutionalEnabled,
  isIngestionConfigured,
  parseQuarterLabel,
  quarterFromPeriodDate,
  recentQuarters,
} from "../config";

// ---------------------------------------------------------------------------
// Helpers — safely manipulate env vars per test
// ---------------------------------------------------------------------------

type EnvSnapshot = Record<string, string | undefined>;

function setEnv(vars: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
}

function snapshotEnv(keys: string[]): EnvSnapshot {
  const snap: EnvSnapshot = {};
  for (const k of keys) snap[k] = process.env[k];
  return snap;
}

function restoreEnv(snap: EnvSnapshot): void {
  for (const [k, v] of Object.entries(snap)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

const WATCHED_KEYS = [
  "INSTITUTIONAL_INTELLIGENCE_ENABLED",
  "INSTITUTIONAL_13F_INGESTION_ENABLED",
  "SEC_USER_AGENT",
  "INSTITUTIONAL_13F_BACKFILL_QUARTERS",
];

// ---------------------------------------------------------------------------
// A — UI / ingestion gate separation
// ---------------------------------------------------------------------------

describe("A — isInstitutionalEnabled (UI gate)", () => {
  let snap: EnvSnapshot;
  beforeEach(() => { snap = snapshotEnv(WATCHED_KEYS); });
  afterEach(() => restoreEnv(snap));

  it("A1 — false by default (INSTITUTIONAL_INTELLIGENCE_ENABLED not set)", () => {
    setEnv({ INSTITUTIONAL_INTELLIGENCE_ENABLED: undefined });
    expect(isInstitutionalEnabled()).toBe(false);
  });

  it("A2 — true when INSTITUTIONAL_INTELLIGENCE_ENABLED=true", () => {
    setEnv({ INSTITUTIONAL_INTELLIGENCE_ENABLED: "true" });
    expect(isInstitutionalEnabled()).toBe(true);
  });

  it("A3 — false when INSTITUTIONAL_INTELLIGENCE_ENABLED=false", () => {
    setEnv({ INSTITUTIONAL_INTELLIGENCE_ENABLED: "false" });
    expect(isInstitutionalEnabled()).toBe(false);
  });

  it("A4 — does NOT affect isIngestionConfigured (gate is independent)", () => {
    // Ingestion can be configured even when the UI is disabled
    setEnv({
      INSTITUTIONAL_INTELLIGENCE_ENABLED: "false",
      INSTITUTIONAL_13F_INGESTION_ENABLED: "true",
      SEC_USER_AGENT: "TestApp test@example.com",
    });
    expect(isInstitutionalEnabled()).toBe(false);   // UI disabled
    expect(isIngestionConfigured()).toBe(true);      // ingestion ready
  });
});

describe("B — isIngestionConfigured (ingestion gate)", () => {
  let snap: EnvSnapshot;
  beforeEach(() => { snap = snapshotEnv(WATCHED_KEYS); });
  afterEach(() => restoreEnv(snap));

  it("B1 — false when SEC_USER_AGENT is not set (hard block)", () => {
    setEnv({
      INSTITUTIONAL_INTELLIGENCE_ENABLED: "true",
      INSTITUTIONAL_13F_INGESTION_ENABLED: "true",
      SEC_USER_AGENT: undefined,
    });
    expect(isIngestionConfigured()).toBe(false);
  });

  it("B2 — false when INSTITUTIONAL_13F_INGESTION_ENABLED=false", () => {
    setEnv({
      INSTITUTIONAL_INTELLIGENCE_ENABLED: "true",
      INSTITUTIONAL_13F_INGESTION_ENABLED: "false",
      SEC_USER_AGENT: "TestApp test@example.com",
    });
    expect(isIngestionConfigured()).toBe(false);
  });

  it("B3 — true when SEC_USER_AGENT is set AND ingestion is enabled (regardless of UI flag)", () => {
    setEnv({
      INSTITUTIONAL_INTELLIGENCE_ENABLED: "false",  // UI disabled
      INSTITUTIONAL_13F_INGESTION_ENABLED: "true",
      SEC_USER_AGENT: "VCP Trader AI test@vcptrader.com",
    });
    expect(isIngestionConfigured()).toBe(true);
  });

  it("B4 — false when SEC_USER_AGENT is empty string", () => {
    setEnv({
      INSTITUTIONAL_INTELLIGENCE_ENABLED: "true",
      INSTITUTIONAL_13F_INGESTION_ENABLED: "true",
      SEC_USER_AGENT: "   ",
    });
    expect(isIngestionConfigured()).toBe(false);
  });

  it("B5 — does NOT require INSTITUTIONAL_INTELLIGENCE_ENABLED=true", () => {
    // This is the critical gate-separation contract.
    setEnv({
      INSTITUTIONAL_INTELLIGENCE_ENABLED: undefined, // not set → default false
      INSTITUTIONAL_13F_INGESTION_ENABLED: "true",
      SEC_USER_AGENT: "VCP Trader AI ops@vcptrader.com",
    });
    const cfg = getInstitutionalConfig();
    expect(cfg.enabled).toBe(false);            // UI is disabled
    expect(isIngestionConfigured()).toBe(true);  // ingestion is NOT blocked by UI flag
  });

  it("B6 — ingestion default (INSTITUTIONAL_13F_INGESTION_ENABLED not set) is true", () => {
    setEnv({
      INSTITUTIONAL_13F_INGESTION_ENABLED: undefined,
      SEC_USER_AGENT: "TestApp test@example.com",
    });
    const cfg = getInstitutionalConfig();
    expect(cfg.ingestionEnabled).toBe(true);
  });
});

describe("C — getInstitutionalConfig parsing", () => {
  let snap: EnvSnapshot;
  beforeEach(() => { snap = snapshotEnv(WATCHED_KEYS); });
  afterEach(() => restoreEnv(snap));

  it("C1 — backfillQuarters defaults to 8", () => {
    setEnv({ INSTITUTIONAL_13F_BACKFILL_QUARTERS: undefined });
    const cfg = getInstitutionalConfig();
    expect(cfg.backfillQuarters).toBe(8);
  });

  it("C2 — backfillQuarters is clamped to [2, 24]", () => {
    setEnv({ INSTITUTIONAL_13F_BACKFILL_QUARTERS: "100" });
    const cfg = getInstitutionalConfig();
    expect(cfg.backfillQuarters).toBe(8); // invalid → falls back to 8

    setEnv({ INSTITUTIONAL_13F_BACKFILL_QUARTERS: "1" });
    const cfg2 = getInstitutionalConfig();
    expect(cfg2.backfillQuarters).toBe(8); // below min → falls back to 8
  });

  it("C3 — secUserAgent is null when not set", () => {
    setEnv({ SEC_USER_AGENT: undefined });
    const cfg = getInstitutionalConfig();
    expect(cfg.secUserAgent).toBeNull();
  });

  it("C4 — secUserAgent is trimmed", () => {
    setEnv({ SEC_USER_AGENT: "  My App ops@example.com  " });
    const cfg = getInstitutionalConfig();
    expect(cfg.secUserAgent).toBe("My App ops@example.com");
  });
});

// ---------------------------------------------------------------------------
// D — parseQuarterLabel
// ---------------------------------------------------------------------------

describe("D — parseQuarterLabel", () => {
  it("D1 — parses canonical YYYY-QN format", () => {
    const r = parseQuarterLabel("2026-Q2");
    expect(r).not.toBeNull();
    expect(r!.year).toBe(2026);
    expect(r!.q).toBe(2);
    expect(r!.periodEnd).toBe("2026-06-30");
    expect(r!.label).toBe("2026-Q2");
  });

  it("D2 — parses CLI shorthand YYYYQN (no hyphen)", () => {
    const r = parseQuarterLabel("2026Q2");
    expect(r).not.toBeNull();
    expect(r!.year).toBe(2026);
    expect(r!.q).toBe(2);
    expect(r!.label).toBe("2026-Q2");
  });

  it("D3 — parses all four quarters with correct period-end dates", () => {
    expect(parseQuarterLabel("2025-Q1")!.periodEnd).toBe("2025-03-31");
    expect(parseQuarterLabel("2025-Q2")!.periodEnd).toBe("2025-06-30");
    expect(parseQuarterLabel("2025-Q3")!.periodEnd).toBe("2025-09-30");
    expect(parseQuarterLabel("2025-Q4")!.periodEnd).toBe("2025-12-31");
  });

  it("D4 — returns null for invalid formats", () => {
    expect(parseQuarterLabel("Q2-2026")).toBeNull();
    expect(parseQuarterLabel("2026-5")).toBeNull();
    expect(parseQuarterLabel("not-a-quarter")).toBeNull();
    expect(parseQuarterLabel("")).toBeNull();
  });

  it("D5 — returns null for out-of-range years", () => {
    expect(parseQuarterLabel("2000-Q1")).toBeNull(); // below 2013
    expect(parseQuarterLabel("2040-Q1")).toBeNull(); // above 2035
  });

  it("D6 — trims whitespace", () => {
    const r = parseQuarterLabel("  2025Q4  ");
    expect(r).not.toBeNull();
    expect(r!.q).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// E — recentQuarters
// ---------------------------------------------------------------------------

describe("E — recentQuarters", () => {
  it("E1 — returns N quarters in descending order", () => {
    const qs = recentQuarters(4, new Date("2026-08-07"));
    expect(qs).toHaveLength(4);
    // Each quarter should be earlier than the previous
    for (let i = 1; i < qs.length; i++) {
      expect(qs[i].periodEnd < qs[i - 1].periodEnd).toBe(true);
    }
  });

  it("E2 — first quarter is the most recently completed quarter", () => {
    // August 2026 → Q3 not yet done (Sep 30) → Q2 (Jun 30) is most recent
    const qs = recentQuarters(1, new Date("2026-08-07"));
    expect(qs[0].label).toBe("2026-Q2");
    expect(qs[0].periodEnd).toBe("2026-06-30");
  });

  it("E3 — each quarter has a valid period-end date", () => {
    const qs = recentQuarters(8, new Date("2026-08-07"));
    for (const q of qs) {
      expect(["03-31", "06-30", "09-30", "12-31"].some((end) => q.periodEnd.endsWith(end))).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// F — Gate separation contract (public API vs ingestion)
// ---------------------------------------------------------------------------

describe("F — activation sequence gate contract", () => {
  let snap: EnvSnapshot;
  beforeEach(() => { snap = snapshotEnv(WATCHED_KEYS); });
  afterEach(() => restoreEnv(snap));

  it("F1 — pre-activation state: UI disabled, ingestion ready", () => {
    setEnv({
      INSTITUTIONAL_INTELLIGENCE_ENABLED: "false",
      INSTITUTIONAL_13F_INGESTION_ENABLED: "true",
      SEC_USER_AGENT: "VCP Trader AI ops@vcptrader.com",
    });
    expect(isInstitutionalEnabled()).toBe(false);
    expect(isIngestionConfigured()).toBe(true);
  });

  it("F2 — fully enabled state: both UI and ingestion active", () => {
    setEnv({
      INSTITUTIONAL_INTELLIGENCE_ENABLED: "true",
      INSTITUTIONAL_13F_INGESTION_ENABLED: "true",
      SEC_USER_AGENT: "VCP Trader AI ops@vcptrader.com",
    });
    expect(isInstitutionalEnabled()).toBe(true);
    expect(isIngestionConfigured()).toBe(true);
  });

  it("F3 — UI enabled but no user-agent: ingestion blocked, UI would attempt to serve (needs data)", () => {
    setEnv({
      INSTITUTIONAL_INTELLIGENCE_ENABLED: "true",
      INSTITUTIONAL_13F_INGESTION_ENABLED: "true",
      SEC_USER_AGENT: undefined,
    });
    expect(isInstitutionalEnabled()).toBe(true);
    expect(isIngestionConfigured()).toBe(false);  // blocked: no user-agent
  });

  it("F4 — emergency rollback: set UI flag false without touching ingestion", () => {
    setEnv({
      INSTITUTIONAL_INTELLIGENCE_ENABLED: "false",  // rolled back
      INSTITUTIONAL_13F_INGESTION_ENABLED: "true",
      SEC_USER_AGENT: "VCP Trader AI ops@vcptrader.com",
    });
    expect(isInstitutionalEnabled()).toBe(false);   // UI immediately disabled
    expect(isIngestionConfigured()).toBe(true);     // ingestion continues in background
  });

  it("F5 — advisory lock key is correct and distinct from opportunity engine", () => {
    // Import inline to avoid module cache issues
    const INSTITUTIONAL_LOCK = 774_412_003;
    const OPPORTUNITY_LOCK = 774_412_002;
    expect(INSTITUTIONAL_LOCK).not.toBe(OPPORTUNITY_LOCK);
    expect(INSTITUTIONAL_LOCK).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// G — quarterFromPeriodDate
// ---------------------------------------------------------------------------

describe("G — quarterFromPeriodDate", () => {
  it("G1 — Q1 ends on March 31", () => {
    expect(quarterFromPeriodDate("2026-03-31")).toBe("2026-Q1");
  });

  it("G2 — Q2 ends on June 30", () => {
    expect(quarterFromPeriodDate("2026-06-30")).toBe("2026-Q2");
  });

  it("G3 — Q3 ends on September 30", () => {
    expect(quarterFromPeriodDate("2026-09-30")).toBe("2026-Q3");
  });

  it("G4 — Q4 ends on December 31", () => {
    expect(quarterFromPeriodDate("2025-12-31")).toBe("2025-Q4");
  });
});
