import { describe, expect, it, vi } from "vitest";
import { OpenFigiClient } from "../openfigi-client";
import {
  normalizeCusip,
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

describe("security reference enrichment", () => {
  it("normalizes only nine-character CUSIPs", () => {
    expect(normalizeCusip(" 67066-g104 ")).toBe("67066G104");
    expect(normalizeCusip("NVDA")).toBeNull();
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
    const sleep = vi.fn().mockResolvedValue(undefined);
    const result = await new OpenFigiClient({ fetch, sleep, maxRetries: 1 }).resolveCusips(["67066G104"]);
    expect(sleep).toHaveBeenCalledWith(3000);
    expect(result[0]).toMatchObject({ outcome: "RATE_LIMITED", retryAfterMs: 3000 });
  });

  it.each([
    ["999999", "numeric"],
    [new Date(Date.now() + 86_400_000).toUTCString(), "far-future date"],
  ])("does not sleep for an over-limit %s Retry-After", async (retryAfter) => {
    const fetch = vi.fn().mockResolvedValue(response({}, 429, { "retry-after": retryAfter }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const result = await new OpenFigiClient({
      fetch, sleep, maxRetries: 2, maxRetryDelayMs: 5_000,
    }).resolveCusips(["67066G104"]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
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
    await new OpenFigiClient({ fetch: noKeyFetch, maxRetries: 0 }).resolveCusips(ids);
    expect(noKeyFetch).toHaveBeenCalledTimes(2);

    const keyFetch = vi.fn().mockResolvedValue(response(Array.from({ length: 11 }, () => ({}))));
    await new OpenFigiClient({ apiKey: "test-key", fetch: keyFetch, maxRetries: 0 }).resolveCusips(ids);
    expect(keyFetch).toHaveBeenCalledTimes(1);
  });
});