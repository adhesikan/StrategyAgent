import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createDemoServer } from "../server.mjs";

const servers = [];

async function start(options = {}) {
  const server = createDemoServer(options);
  servers.push(server);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

function upstreamResponse(body, status = 200, headers = {}) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

describe("external consumer proxy", () => {
  it("keeps the API key on the backend and forwards only an approved route", async () => {
    let seen;
    const base = await start({
      baseUrl: "https://api.example.test",
      apiKey: "sm_test_never-in-browser",
      fetchImpl: async (url, init) => {
        seen = { url: String(url), headers: init.headers };
        return upstreamResponse({ data: { items: [] }, meta: {} });
      },
    });
    const response = await fetch(`${base}/api/demo/institutional/accumulation?limit=10`);
    assert.equal(response.status, 200);
    assert.equal(seen.url, "https://api.example.test/api/v1/institutional/trends/accumulation?limit=10");
    assert.equal(seen.headers.authorization, "Bearer sm_test_never-in-browser");
    const html = await (await fetch(`${base}/`)).text();
    assert.equal(html.includes("sm_test_never-in-browser"), false);
  });

  it("rejects unsupported paths, methods, symbols, and query parameters", async () => {
    const base = await start({ baseUrl: "https://api.example.test", apiKey: "secret", fetchImpl: async () => upstreamResponse({}) });
    const cases = [
      ["/api/demo/private/users", 404, "NOT_FOUND"],
      ["/api/demo/institutional/stocks/not%20valid", 400, "INVALID_SYMBOL"],
      ["/api/demo/institutional/accumulation?sortBy=sql", 400, "INVALID_QUERY"],
      ["/api/demo/institutional/accumulation?marketCapMin=10&marketCapMax=1", 400, "INVALID_QUERY"],
      ["/api/demo/institutional/accumulation?limit=1&limit=100", 400, "INVALID_QUERY"],
      ["/api/demo/institutional/accumulation?offset=", 400, "INVALID_QUERY"],
      ["/api/demo/multibagger/ALFA?limit=100", 400, "INVALID_QUERY"],
      ["/api/demo/institutional/stocks/ALFA?cohort=insurance", 400, "INVALID_QUERY"],
    ];
    for (const [path, status, code] of cases) {
      const response = await fetch(`${base}${path}`);
      const body = await response.json();
      assert.equal(response.status, status);
      assert.equal(body.error.code, code);
    }
    const post = await fetch(`${base}/api/demo/multibagger/screener`, { method: "POST" });
    assert.equal(post.status, 405);
  });

  it("handles missing configuration without calling upstream", async () => {
    let called = false;
    const base = await start({ fetchImpl: async () => { called = true; return upstreamResponse({}); } });
    const response = await fetch(`${base}/api/demo/multibagger/screener`);
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.error.code, "DEMO_NOT_CONFIGURED");
    assert.equal(called, false);
  });

  it("preserves safe upstream status and error code without leaking body details", async () => {
    const base = await start({
      baseUrl: "https://api.example.test",
      apiKey: "secret",
      fetchImpl: async () => upstreamResponse({ error: { code: "INSUFFICIENT_SCOPE", message: "secret internal detail" } }, 403),
    });
    const response = await fetch(`${base}/api/demo/multibagger/screener`);
    const body = await response.json();
    assert.equal(response.status, 403);
    assert.equal(body.error.code, "INSUFFICIENT_SCOPE");
    assert.equal(body.error.message.includes("secret internal detail"), false);
    assert.equal(JSON.stringify(body).includes("secret"), false);
  });

  it("maps timeout, network failure, invalid JSON, empty data, and upstream 500 safely", async () => {
    const timeout = await start({
      baseUrl: "https://api.example.test", apiKey: "secret",
      timeoutMs: 10,
      fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => { const error = new Error("aborted"); error.name = "AbortError"; reject(error); });
      }),
    });
    assert.equal((await (await fetch(`${timeout}/api/demo/institutional/accumulation`)).json()).error.code, "UPSTREAM_TIMEOUT");

    const slowBody = await start({
      baseUrl: "https://api.example.test", apiKey: "secret", timeoutMs: 10,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => new Promise(() => undefined),
      }),
    });
    assert.equal((await (await fetch(`${slowBody}/api/demo/institutional/accumulation`)).json()).error.code, "UPSTREAM_TIMEOUT");

    const network = await start({ baseUrl: "https://api.example.test", apiKey: "secret", fetchImpl: async () => { throw new Error("socket details"); } });
    const networkBody = await (await fetch(`${network}/api/demo/institutional/accumulation`)).json();
    assert.equal(networkBody.error.code, "UPSTREAM_NETWORK_ERROR");
    assert.equal(JSON.stringify(networkBody).includes("socket"), false);

    const invalid = await start({ baseUrl: "https://api.example.test", apiKey: "secret", fetchImpl: async () => upstreamResponse("{not-json") });
    assert.equal((await (await fetch(`${invalid}/api/demo/institutional/accumulation`)).json()).error.code, "UPSTREAM_INVALID_JSON");

    const empty = await start({ baseUrl: "https://api.example.test", apiKey: "secret", fetchImpl: async () => upstreamResponse({ data: { items: [] }, meta: {} }) });
    assert.deepEqual((await (await fetch(`${empty}/api/demo/institutional/accumulation`)).json()).data.items, []);

    const failed = await start({ baseUrl: "https://api.example.test", apiKey: "secret", fetchImpl: async () => upstreamResponse({ error: { code: "INTERNAL_ERROR" } }, 500) });
    const failedResponse = await fetch(`${failed}/api/demo/institutional/accumulation`);
    assert.equal(failedResponse.status, 500);
    assert.equal((await failedResponse.json()).error.code, "INTERNAL_ERROR");
  });

  it("preserves each approved upstream status with a safe message", async () => {
    for (const status of [400, 401, 403, 404, 429, 500]) {
      const base = await start({
        baseUrl: "https://api.example.test",
        apiKey: "secret",
        fetchImpl: async () => upstreamResponse({ error: { code: `UPSTREAM_${status}`, message: "private detail" } }, status),
      });
      const response = await fetch(`${base}/api/demo/institutional/accumulation`);
      const body = await response.json();
      assert.equal(response.status, status);
      assert.equal(body.error.code, `UPSTREAM_${status}`);
      assert.equal(body.error.message.includes("private"), false);
    }
  });

  it("normalizes validated filters and accepts every documented cohort", async () => {
    const forwarded = [];
    const base = await start({
      baseUrl: "https://api.example.test",
      apiKey: "secret",
      fetchImpl: async (url) => {
        forwarded.push(String(url));
        return upstreamResponse({ data: {}, meta: {} });
      },
    });
    for (const cohort of [
      "hedge_fund", "pension", "sovereign", "endowment", "asset_manager",
      "quantitative", "technology_specialist", "healthcare_specialist",
      "concentrated", "broad_diversified",
    ]) {
      const response = await fetch(`${base}/api/demo/institutional/stocks/ALFA?cohort=${cohort}`);
      assert.equal(response.status, 200);
    }
    const normalized = await fetch(`${base}/api/demo/institutional/accumulation?limit=%20010%20&sector=%20Technology%20`);
    assert.equal(normalized.status, 200);
    assert.match(forwarded.at(-1), /limit=10/);
    assert.match(forwarded.at(-1), /sector=Technology/);
    assert.equal(forwarded.at(-1).includes("010"), false);
  });
});