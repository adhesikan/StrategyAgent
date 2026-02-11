import type { IFuturesBrokerAdapter } from "../brokers/futures/types";
import { MockFuturesAdapter } from "../brokers/futures/mock/MockFuturesAdapter";

export async function createFuturesAdapter(): Promise<IFuturesBrokerAdapter> {
  const feed = process.env.FUTURES_FEED?.toLowerCase();

  if (feed === "rithmic") {
    console.log("[AdapterFactory] FUTURES_FEED=rithmic, attempting Rithmic adapter...");

    try {
      const { importRithmicApi } = await import("../../../scripts/import-rithmic-api");
      const importOk = await importRithmicApi();

      if (!importOk) {
        console.warn("[AdapterFactory] Rithmic proto import failed, falling back to mock");
        return new MockFuturesAdapter();
      }

      const { validateProtos } = await import("../brokers/rithmic/codec");
      const validation = await validateProtos();

      if (!validation.valid) {
        console.warn(`[AdapterFactory] Rithmic proto validation failed: ${validation.errors.join(", ")}`);
        console.warn("[AdapterFactory] Falling back to mock adapter");
        return new MockFuturesAdapter();
      }

      const tickerUri = process.env.RITHMIC_TICKER_PLANT_URI;
      const orderUri = process.env.RITHMIC_ORDER_PLANT_URI;
      const systemName = process.env.RITHMIC_SYSTEM_NAME;
      const userId = process.env.RITHMIC_USER_ID;
      const password = process.env.RITHMIC_PASSWORD;

      if (!tickerUri || !orderUri || !systemName || !userId || !password) {
        console.warn("[AdapterFactory] Missing Rithmic config env vars (RITHMIC_TICKER_PLANT_URI, RITHMIC_ORDER_PLANT_URI, RITHMIC_SYSTEM_NAME, RITHMIC_USER_ID, RITHMIC_PASSWORD)");
        console.warn("[AdapterFactory] Falling back to mock adapter");
        return new MockFuturesAdapter();
      }

      const { RithmicProtocolAdapter } = await import("../brokers/rithmic/RithmicProtocolAdapter");
      const adapter = new RithmicProtocolAdapter({
        tickerPlantUri: tickerUri,
        orderPlantUri: orderUri,
        systemName,
        userId,
        password,
        appName: "VCPTrader",
        appVersion: "1.0.0",
        fcmId: process.env.RITHMIC_FCM_ID,
        ibId: process.env.RITHMIC_IB_ID,
        accountId: process.env.RITHMIC_ACCOUNT_ID,
      });

      console.log("[AdapterFactory] Rithmic adapter created successfully");
      return adapter;
    } catch (err) {
      console.error("[AdapterFactory] Rithmic adapter creation failed:", err instanceof Error ? err.message : err);
      console.warn("[AdapterFactory] Falling back to mock adapter");
      return new MockFuturesAdapter();
    }
  }

  console.log("[AdapterFactory] Using mock futures adapter (set FUTURES_FEED=rithmic to use Rithmic)");
  return new MockFuturesAdapter();
}
