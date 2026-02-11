import { resolveRithmicConfig } from "./config";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  PASS: ${name}`);
  } catch (err: any) {
    console.error(`  FAIL: ${name} - ${err.message}`);
    process.exitCode = 1;
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg);
}

console.log("\n--- resolveRithmicConfig tests ---\n");

test("Protocol mode: RITHMIC_WS_URL present", () => {
  const cfg = resolveRithmicConfig({
    RITHMIC_WS_URL: "wss://test.rithmic.com:443",
    RITHMIC_SYSTEM_NAME: "Rithmic Test",
    RITHMIC_USER_ID: "user@test.com",
    RITHMIC_PASSWORD: "pass123",
  });
  assert(cfg.mode === "protocol", `Expected mode=protocol, got ${cfg.mode}`);
  assert(cfg.wsUrl === "wss://test.rithmic.com:443", `Unexpected wsUrl: ${cfg.wsUrl}`);
  assert(cfg.missing.length === 0, `Expected no missing, got: ${cfg.missing.join(", ")}`);
  assert(cfg.systemName === "Rithmic Test", `Unexpected systemName: ${cfg.systemName}`);
});

test("Plant mode: both plant URIs present", () => {
  const cfg = resolveRithmicConfig({
    RITHMIC_TICKER_PLANT_URI: "wss://ticker.rithmic.com:443",
    RITHMIC_ORDER_PLANT_URI: "wss://order.rithmic.com:443",
    RITHMIC_USER_ID: "user@test.com",
    RITHMIC_PASSWORD: "pass123",
  });
  assert(cfg.mode === "plant", `Expected mode=plant, got ${cfg.mode}`);
  assert(cfg.tickerPlantUri === "wss://ticker.rithmic.com:443", "Bad tickerPlantUri");
  assert(cfg.orderPlantUri === "wss://order.rithmic.com:443", "Bad orderPlantUri");
  assert(cfg.missing.length === 0, `Expected no missing, got: ${cfg.missing.join(", ")}`);
  assert(cfg.systemName === "Rithmic Test", "Default systemName should be 'Rithmic Test'");
});

test("Missing credentials: userId and password", () => {
  const cfg = resolveRithmicConfig({
    RITHMIC_WS_URL: "wss://test.rithmic.com:443",
  });
  assert(cfg.mode === "protocol", `Expected mode=protocol, got ${cfg.mode}`);
  assert(cfg.missing.includes("RITHMIC_USER_ID"), "Should report RITHMIC_USER_ID missing");
  assert(cfg.missing.includes("RITHMIC_PASSWORD"), "Should report RITHMIC_PASSWORD missing");
});

test("No URL config at all: reports missing connection info", () => {
  const cfg = resolveRithmicConfig({
    RITHMIC_USER_ID: "user@test.com",
    RITHMIC_PASSWORD: "pass123",
  });
  assert(cfg.missing.length > 0, "Should have missing items");
  assert(
    cfg.missing.some((m) => m.includes("RITHMIC_WS_URL") || m.includes("RITHMIC_TICKER_PLANT_URI")),
    `Expected URL-related missing, got: ${cfg.missing.join(", ")}`
  );
});

test("Partial plant config: only ticker URI", () => {
  const cfg = resolveRithmicConfig({
    RITHMIC_TICKER_PLANT_URI: "wss://ticker.rithmic.com:443",
    RITHMIC_USER_ID: "user@test.com",
    RITHMIC_PASSWORD: "pass123",
  });
  assert(cfg.missing.includes("RITHMIC_ORDER_PLANT_URI"), "Should report RITHMIC_ORDER_PLANT_URI missing");
});

test("Partial plant config: only order URI", () => {
  const cfg = resolveRithmicConfig({
    RITHMIC_ORDER_PLANT_URI: "wss://order.rithmic.com:443",
    RITHMIC_USER_ID: "user@test.com",
    RITHMIC_PASSWORD: "pass123",
  });
  assert(cfg.missing.includes("RITHMIC_TICKER_PLANT_URI"), "Should report RITHMIC_TICKER_PLANT_URI missing");
});

test("Protocol mode takes priority over plant URIs when RITHMIC_WS_URL is set", () => {
  const cfg = resolveRithmicConfig({
    RITHMIC_WS_URL: "wss://protocol.rithmic.com:443",
    RITHMIC_TICKER_PLANT_URI: "wss://ticker.rithmic.com:443",
    RITHMIC_ORDER_PLANT_URI: "wss://order.rithmic.com:443",
    RITHMIC_USER_ID: "user@test.com",
    RITHMIC_PASSWORD: "pass123",
  });
  assert(cfg.mode === "protocol", "Protocol mode should take priority");
  assert(cfg.wsUrl === "wss://protocol.rithmic.com:443", "Should use RITHMIC_WS_URL");
  assert(cfg.missing.length === 0, "No missing vars expected");
});

console.log("\n--- All tests complete ---\n");
