import { beforeEach, describe, expect, it, vi } from "vitest";
import { OpenFigiClient, resetOpenFigiProviderSchedulersForTests } from "../openfigi-client";
import {
  normalizeCusip,
  assessCanonicalPrimarySymbol,
  resolveReviewedSecurityReference,
  sortSecurityReferenceCandidates,
  type SecurityReferenceCandidate,
} from "../security-reference-enrichment";

const response = (body: unknown, status = 200, headers?: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const figi = (ticker: string, securityType = "Common Stock") => ({
  figi: `BBG${ticker}`, ticker, name: `${ticker} security`, securityType, marketSector: "Equity",
});

async function lookup(body: unknown, options: ConstructorParameters<typeof OpenFigiClient>[0] = {}) {
  const fetch = vi.fn().mockResolvedValue(response(body));
  const client = new OpenFigiClient({ fetch, maxRetries: 0, ...options });
  return { result: await client.resolveCusips(["67066-g104"]), fetch };
}

function testClock() {
  let current = 0;
  const sleep = vi.fn(async (milliseconds: number) => { current += milliseconds; });
  return { now: () => current, sleep };
}

describe("security reference enrichment", () => {
  beforeEach(() => {
    resetOpenFigiProviderSchedulersForTests();
  });

  it("normalizes only nine-character CUSIPs", () => {
    expect(normalizeCusip(" 67066-g104 ")).toBe("67066G104");
    expect(normalizeCusip("NVDA")).toBeNull();
  });

  it.each([
    ["AAPL", undefined, "ACCEPTED_PROVIDER_TICKER"],
    ["BRK.B", "BBGCLASSB", "ACCEPTED_PROVIDER_TICKER"],
    ["BRK.B", undefined, "SHARE_CLASS_EVIDENCE_REQUIRED"],
    ["NYSE:AAPL", undefined, "INVALID_PRIMARY_TICKER_FORMAT"],
    ["", undefined, "MISSING_PRIMARY_TICKER"],
  ] as const)("assesses %s without ticker heuristics", (ticker, shareClassFigi, status) => {
    expect(assessCanonicalPrimarySymbol({ ticker, shareClassFigi })).toMatchObject({ status });
  });

  it("submits exact ID_CUSIP jobs and resolves a standard common stock", async () => {
    const { result, fetch } = await lookup([{ data: [figi("NVDA")] }]);
    expect(result[0]).toMatchObject({ cusip: "67066G104", outcome: "AUTHORITATIVELY_RESOLVABLE", symbol: "NVDA" });
    expect(JSON.parse(String(fetch.mock.calls[0][1].body))).toEqual([{ idType: "ID_CUSIP", idValue: "67066G104" }]);
  });

  it("handles multiple CUSIPs independently and preserves input order", async () => {
    const fetch = vi.fn().mockResolvedValue(response([{ data: [figi("AAA")] }, { data: [figi("BBB")] }]));
    const result = await new OpenFigiClient({ fetch, maxRetries: 0 }).resolveCusips(["111111111", "222222222"]);
    expect(result.map((item) => item.symbol)).toEqual(["AAA", "BBB"]);
  });

  it("preserves share-class candidates rather than collapsing them", async () => {
    const { result } = await lookup([{ data: [
      { ...figi("BRK.B"), shareClassFIGI: "BBGCLASSB" },
      { ...figi("BRK.B"), shareClassFIGI: "BBGCLASSB2" },
    ] }]);
    expect(result[0]).toMatchObject({ outcome: "AUTHORITATIVELY_RESOLVABLE", symbol: "BRK.B" });
    expect(result[0].candidates).toHaveLength(2);
  });

  it.each([
    ["ETF", "ETF"],
    ["ADR", "Depositary Receipt"],
    ["foreign/special", "Foreign Share"],
  ])("explicitly retains %s security types", async (_label, type) => {
    const { result } = await lookup([{ data: [figi("XYZ", type)] }]);
    expect(result[0]).toMatchObject({ outcome: "AUTHORITATIVELY_RESOLVABLE" });
    expect(result[0].candidates[0].securityType).toBe(type);
  });

  it("never auto-resolves differing symbols returned for one CUSIP", async () => {
    const { result } = await lookup([{ data: [figi("AAA"), figi("BBB")] }]);
    expect(result[0]).toMatchObject({ outcome: "AMBIGUOUS", symbol: null });
    expect(result[0].candidates).toHaveLength(2);
  });

  it("keeps an exchange-qualified provider ticker out of canonical identity evidence", () => {
    const result = resolveReviewedSecurityReference("67066G104", [], [{
      provider: "openfigi",
      ticker: "NYSE:AAPL",
      figi: "BBGAAPL",
      securityType: "Common Stock",
    }]);
    expect(result).toMatchObject({
      outcome: "UNSUPPORTED",
      symbol: null,
    });
    expect(result.candidates).toHaveLength(1);
  });

  it("keeps provider-only symbol ambiguity distinct from an exact-evidence conflict", () => {
    const providerAmbiguity = resolveReviewedSecurityReference("67066G104", [], [
      { provider: "openfigi", ticker: "AAA", securityType: "Common Stock" },
      { provider: "openfigi", ticker: "BBB", securityType: "Common Stock" },
    ]);
    expect(providerAmbiguity).toMatchObject({ outcome: "AMBIGUOUS", symbol: null });

    const localProviderConflict = resolveReviewedSecurityReference("67066G104", [
      { source: "local-exact", cusip: "67066G104", symbol: "AAA", status: "exact" },
    ], [
      { provider: "openfigi", ticker: "BBB", figi: "BBGB", securityType: "Common Stock" },
    ]);
    expect(localProviderConflict).toMatchObject({ outcome: "CONFLICTING", symbol: null });
  });

  it("gives reviewed evidence precedence over exact/provider evidence", () => {
    expect(resolveReviewedSecurityReference("67066G104", [
      { source: "review", cusip: "67066G104", symbol: "NVDA", status: "reviewed" },
      { source: "legacy", cusip: "67066G104", symbol: "WRONG", status: "exact" },
    ], [{ provider: "openfigi", ticker: "OTHER" }])).toMatchObject({
      outcome: "AUTHORITATIVELY_RESOLVABLE", symbol: "NVDA",
    });
  });

  it("returns no-reference distinctly from unsupported input", async () => {
    const { result } = await lookup([{}]);
    expect(result[0]).toMatchObject({ outcome: "NO_REFERENCE_AVAILABLE" });
    const invalid = await new OpenFigiClient({ fetch: vi.fn(), maxRetries: 0 }).resolveCusips(["1234"]);
    expect(invalid[0]).toMatchObject({ outcome: "UNSUPPORTED", errorCode: "INVALID_CUSIP" });
  });

  it("reports provider failures without leaking request details", async () => {
    const fetch = vi.fn().mockResolvedValue(response({}, 503));
    const result = await new OpenFigiClient({ fetch, maxRetries: 0 }).resolveCusips(["67066G104"]);
    expect(result[0]).toMatchObject({ outcome: "PROVIDER_FAILED", errorCode: "HTTP_503" });
  });

  it("honors Retry-After and returns rate-limited after bounded retries", async () => {
    const fetch = vi.fn().mockResolvedValue(response({}, 429, { "retry-after": "3" }));
    const { now, sleep } = testClock();
    const result = await new OpenFigiClient({ fetch, sleep, now, maxRetries: 1 }).resolveCusips(["67066G104"]);
    expect(sleep).toHaveBeenCalledWith(3000);
    expect(result[0]).toMatchObject({ outcome: "RATE_LIMITED", retryAfterMs: 3000 });
  });

  it("uses ratelimit-reset when Retry-After is absent and retries successfully", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response({}, 429, { "ratelimit-reset": "2" }))
      .mockResolvedValueOnce(response([{ data: [figi("NVDA")] }]));
    const { now, sleep } = testClock();
    const result = await new OpenFigiClient({ fetch, sleep, now, maxRetries: 1 }).resolveCusips(["67066G104"]);
    expect(sleep).toHaveBeenCalledWith(2000);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result[0]).toMatchObject({ outcome: "AUTHORITATIVELY_RESOLVABLE", symbol: "NVDA" });
  });

  it("retries transient provider failures with bounded exponential backoff", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response({}, 503))
      .mockResolvedValueOnce(response([{ data: [figi("NVDA")] }]));
    const { now, sleep } = testClock();
    const result = await new OpenFigiClient({
      fetch, sleep, now, maxRetries: 1, backoffMs: 100,
    }).resolveCusips(["67066G104"]);
    expect(sleep).toHaveBeenCalledWith(100);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result[0]).toMatchObject({ outcome: "AUTHORITATIVELY_RESOLVABLE", symbol: "NVDA" });
  });

  it.each([
    ["999999", "numeric"],
    [new Date(Date.now() + 86_400_000).toUTCString(), "far-future date"],
  ])("bounds and retries an over-limit %s Retry-After", async (retryAfter) => {
    const fetch = vi.fn().mockResolvedValue(response({}, 429, { "retry-after": retryAfter }));
    const { now, sleep } = testClock();
    const result = await new OpenFigiClient({
      fetch, sleep, now, maxRetries: 2, maxRetryDelayMs: 5_000,
    }).resolveCusips(["67066G104"]);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(5_000);
    expect(result[0]).toMatchObject({ outcome: "RATE_LIMITED", errorCode: "HTTP_429", retryAfterMs: 5_000 });
  });

  it("marks missing positional responses partial rather than shifting results", async () => {
    const fetch = vi.fn().mockResolvedValue(response([{ data: [figi("AAA")] }]));
    const result = await new OpenFigiClient({ fetch, maxRetries: 0 }).resolveCusips(["111111111", "222222222"]);
    expect(result.map((item) => item.outcome)).toEqual(["AUTHORITATIVELY_RESOLVABLE", "PARTIAL_RESPONSE"]);
  });

  it("has stable candidate ordering and fingerprints", () => {
    const candidates: SecurityReferenceCandidate[] = [
      { provider: "openfigi", ticker: "ZZZ", figi: "BBGZ", securityType: "Common Stock" },
      { provider: "openfigi", ticker: "AAA", figi: "BBGA", securityType: "Common Stock" },
    ];
    expect(sortSecurityReferenceCandidates(candidates).map((item) => item.ticker)).toEqual(["AAA", "ZZZ"]);
    const first = resolveReviewedSecurityReference("111111111", [], candidates);
    const second = resolveReviewedSecurityReference("111111111", [], [...candidates].reverse());
    expect(second).toEqual(first);
  });

  it.each(["Debt", "Option", "Preferred Stock"])("marks non-eligible %s candidates unsupported", async (type) => {
    const { result } = await lookup([{ data: [figi("NOPE", type)] }]);
    expect(result[0]).toMatchObject({ outcome: "UNSUPPORTED", symbol: null });
  });

  it("uses supported candidates in mixed responses while retaining all candidates", async () => {
    const { result } = await lookup([{ data: [figi("DEBT", "Debt"), figi("SPY", "ETF")] }]);
    expect(result[0]).toMatchObject({ outcome: "AUTHORITATIVELY_RESOLVABLE", symbol: "SPY" });
    expect(result[0].candidates).toHaveLength(2);
  });

  it("maps OpenFIGI no-match item errors to no reference", async () => {
    const { result } = await lookup([{ error: "No identifier found." }]);
    expect(result[0]).toMatchObject({ outcome: "NO_REFERENCE_AVAILABLE" });
  });

  it("does not expose unmodeled raw provider payload fields", async () => {
    const { result } = await lookup([{ data: [{ ...figi("NVDA"), internalProprietaryField: "do-not-persist" }] }]);
    expect(result[0].candidates[0]).not.toHaveProperty("raw");
    expect(result[0].candidates[0]).not.toHaveProperty("internalProprietaryField");
  });

  it("uses unauthenticated batches of 10 and authenticated batches of 100", async () => {
    const ids = Array.from({ length: 11 }, (_, index) => `1234567${String(index).padStart(2, "0")}`);
    const noKeyFetch = vi.fn().mockResolvedValue(response(Array.from({ length: 10 }, () => ({}))));
    const unauthenticatedClock = testClock();
    await new OpenFigiClient({ fetch: noKeyFetch, maxRetries: 0, ...unauthenticatedClock }).resolveCusips(ids);
    expect(noKeyFetch).toHaveBeenCalledTimes(2);

    const keyFetch = vi.fn().mockResolvedValue(response(Array.from({ length: 11 }, () => ({}))));
    await new OpenFigiClient({ apiKey: "test-key", fetch: keyFetch, maxRetries: 0 }).resolveCusips(ids);
    expect(keyFetch).toHaveBeenCalledTimes(1);
  });

  it("reports only the safe authentication mode", () => {
    expect(new OpenFigiClient({ apiKey: "secret-value" }).authMode).toBe("KEYED");
    expect(new OpenFigiClient({ apiKey: "" }).authMode).toBe("UNAUTHENTICATED");
  });

  it("proactively paces each official OpenFIGI tier and exposes its safe profile", async () => {
    const unauthenticatedClock = testClock();
    const unauthenticated = new OpenFigiClient({ fetch: vi.fn().mockResolvedValue(response([{}])), ...unauthenticatedClock });
    await unauthenticated.resolveCusips(Array.from({ length: 11 }, (_, index) => `1234567${String(index).padStart(2, "0")}`));
    expect(unauthenticatedClock.sleep).toHaveBeenCalledWith(2400);
    expect(unauthenticated.executionProfile).toEqual({
      authMode: "UNAUTHENTICATED", batchSize: 10, concurrency: 1,
      requestLimit: 25, windowMs: 60_000, minimumIntervalMs: 2400,
    });

    const keyedClock = testClock();
    const keyed = new OpenFigiClient({ apiKey: "secret-value", fetch: vi.fn().mockResolvedValue(response([{}])), ...keyedClock });
    await keyed.resolveCusips(Array.from({ length: 101 }, (_, index) => `123456${String(index).padStart(3, "0")}`.slice(-9)));
    expect(keyedClock.sleep).toHaveBeenCalledWith(240);
    expect(keyed.executionProfile).toMatchObject({
      authMode: "KEYED", batchSize: 100, requestLimit: 25, windowMs: 6000, minimumIntervalMs: 240,
    });
  });

  it("shares proactive pacing across unauthenticated clients but not distinct keys", async () => {
    const clock = testClock();
    const firstFetch = vi.fn().mockImplementation(async () => response([{}]));
    const secondFetch = vi.fn().mockImplementation(async () => response([{}]));
    await new OpenFigiClient({ fetch: firstFetch, ...clock }).resolveCusips(["111111111"]);
    await new OpenFigiClient({ fetch: secondFetch, ...clock }).resolveCusips(["222222222"]);
    expect(clock.sleep).toHaveBeenCalledWith(2400);

    resetOpenFigiProviderSchedulersForTests();
    const keyedClock = testClock();
    await new OpenFigiClient({ apiKey: "key-one", fetch: firstFetch, ...keyedClock }).resolveCusips(["111111111"]);
    await new OpenFigiClient({ apiKey: "key-two", fetch: secondFetch, ...keyedClock }).resolveCusips(["222222222"]);
    expect(keyedClock.sleep).not.toHaveBeenCalled();
  });

  it("shares pacing and a single 429 cooldown between clients using one key", async () => {
    const clock = testClock();
    const firstFetch = vi.fn()
      .mockResolvedValueOnce(response({}, 429, { "retry-after": "2" }))
      .mockResolvedValueOnce(response([{ data: [figi("AAA")] }]));
    const secondFetch = vi.fn().mockResolvedValue(response([{ data: [figi("BBB")] }]));
    const first = new OpenFigiClient({
      apiKey: "same-key", fetch: firstFetch, ...clock, maxRetries: 1, concurrency: 2,
    });
    const second = new OpenFigiClient({
      apiKey: "same-key", fetch: secondFetch, ...clock, maxRetries: 0, concurrency: 2,
    });
    const [firstResult, secondResult] = await Promise.all([
      first.resolveCusips(["111111111"]),
      second.resolveCusips(["222222222"]),
    ]);
    expect(clock.sleep).toHaveBeenCalledWith(240);
    expect(clock.sleep.mock.calls.filter(([milliseconds]) => milliseconds === 2000)).toHaveLength(1);
    expect(firstResult[0].symbol).toBe("AAA");
    expect(secondResult[0].symbol).toBe("BBB");
  });

  it("honors the active tier's full reset window by default", async () => {
    const unauthenticatedClock = testClock();
    const unauthenticatedFetch = vi.fn()
      .mockResolvedValueOnce(response({}, 429, { "retry-after": "60" }))
      .mockResolvedValueOnce(response([{}]));
    const unauthenticated = await new OpenFigiClient({
      fetch: unauthenticatedFetch, maxRetries: 1, ...unauthenticatedClock,
    }).resolveCusips(["67066G104"]);
    expect(unauthenticatedClock.sleep).toHaveBeenCalledWith(60_000);
    expect(unauthenticated[0].outcome).toBe("NO_REFERENCE_AVAILABLE");

    const keyedClock = testClock();
    const keyedFetch = vi.fn()
      .mockResolvedValueOnce(response({}, 429, { "ratelimit-reset": "6" }))
      .mockResolvedValueOnce(response([{}]));
    const keyed = await new OpenFigiClient({
      apiKey: "secret-value", fetch: keyedFetch, maxRetries: 1, ...keyedClock,
    }).resolveCusips(["67066G104"]);
    expect(keyedClock.sleep).toHaveBeenCalledWith(6_000);
    expect(keyed[0].outcome).toBe("NO_REFERENCE_AVAILABLE");
  });

  it("keeps output order when scheduled batches complete out of order", async () => {
    const ids = Array.from({ length: 11 }, (_, index) => `1234567${String(index).padStart(2, "0")}`);
    let releaseFirst!: () => void;
    const first = new Promise<Response>((resolve) => {
      releaseFirst = () => resolve(response(Array.from(
        { length: 10 }, (_, index) => ({ data: [figi(`A${index}`)] }),
      )));
    });
    const fetch = vi.fn()
      .mockImplementationOnce(() => first)
      .mockResolvedValueOnce(response([{ data: [figi("LAST")] }]));
    const clock = testClock();
    const pending = new OpenFigiClient({ fetch, concurrency: 2, maxRetries: 0, ...clock }).resolveCusips(ids);
    await Promise.resolve();
    releaseFirst();
    const result = await pending;
    expect(result.map((item) => item.symbol)).toEqual([...Array.from({ length: 10 }, (_, index) => `A${index}`), "LAST"]);
  });

  it("shares one bounded 429 cooldown across scheduled batches", async () => {
    const ids = Array.from({ length: 11 }, (_, index) => `1234567${String(index).padStart(2, "0")}`);
    const { now, sleep } = testClock();
    const fetch = vi.fn()
      .mockResolvedValueOnce(response({}, 429, { "retry-after": "2" }))
      .mockResolvedValueOnce(response([{ data: [figi("LAST")] }]))
      .mockResolvedValueOnce(response(Array.from({ length: 10 }, (_, index) => ({ data: [figi(`A${index}`)] }))));
    const result = await new OpenFigiClient({
      fetch, sleep, now, concurrency: 2, maxRetries: 1,
    }).resolveCusips(ids);
    expect(sleep.mock.calls.filter(([milliseconds]) => milliseconds === 2000)).toHaveLength(1);
    expect(result.map((item) => item.symbol)).toEqual([...Array.from({ length: 10 }, (_, index) => `A${index}`), "LAST"]);
  });
});