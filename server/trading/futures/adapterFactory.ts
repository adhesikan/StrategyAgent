import type { IFuturesBrokerAdapter } from "../brokers/futures/types";
import { MockFuturesAdapter } from "../brokers/futures/mock/MockFuturesAdapter";
import { resolveRithmicConfig, type RithmicMode } from "../brokers/rithmic/config";

export type FuturesFeedType = "mock" | "rithmic";

export interface AdapterResult {
  adapter: IFuturesBrokerAdapter;
  feedType: FuturesFeedType;
  feedDetail?: string;
  rithmicModeDetected: RithmicMode | null;
  missingEnvVars: string[];
  lastInitError: string | null;
}

function mockResult(opts: {
  reason?: string;
  missingEnvVars?: string[];
  lastInitError?: string | null;
  rithmicModeDetected?: RithmicMode | null;
}): AdapterResult {
  return {
    adapter: new MockFuturesAdapter(),
    feedType: "mock",
    feedDetail: opts.reason ?? "default",
    rithmicModeDetected: opts.rithmicModeDetected ?? null,
    missingEnvVars: opts.missingEnvVars ?? [],
    lastInitError: opts.lastInitError ?? null,
  };
}

export async function createFuturesAdapter(): Promise<AdapterResult> {
  const feed = process.env.FUTURES_FEED?.toLowerCase();

  if (feed !== "rithmic") {
    console.log("[AdapterFactory] Using mock futures adapter (FUTURES_FEED is not set to 'rithmic')");
    return mockResult({ reason: "FUTURES_FEED not set to rithmic" });
  }

  console.log("[AdapterFactory] FUTURES_FEED=rithmic, resolving config...");

  const cfg = resolveRithmicConfig(process.env);

  console.log(`[AdapterFactory] Rithmic mode detected: ${cfg.mode}`);
  console.log(`[AdapterFactory] System name: ${cfg.systemName}`);
  console.log(`[AdapterFactory] User ID: ${cfg.userId ? cfg.userId.substring(0, 3) + "***" : "(missing)"}`);
  if (cfg.mode === "protocol") {
    console.log(`[AdapterFactory] WebSocket URL: ${cfg.wsUrl ?? "(missing)"}`);
  } else {
    console.log(`[AdapterFactory] Ticker plant URI: ${cfg.tickerPlantUri ?? "(missing)"}`);
    console.log(`[AdapterFactory] Order plant URI: ${cfg.orderPlantUri ?? "(missing)"}`);
  }

  if (cfg.missing.length > 0) {
    const msg = `Missing Rithmic config: ${cfg.missing.join(", ")}`;
    console.warn(`[AdapterFactory] ${msg}`);
    console.warn("[AdapterFactory] Falling back to mock adapter");
    return mockResult({
      reason: msg,
      missingEnvVars: cfg.missing,
      rithmicModeDetected: cfg.missing.length <= 2 ? cfg.mode : null,
    });
  }

  try {
    const { importRithmicApi } = await import("../../../scripts/import-rithmic-api");
    const importOk = await importRithmicApi();

    if (!importOk) {
      console.warn("[AdapterFactory] Rithmic proto import failed, falling back to mock");
      return mockResult({
        reason: "Rithmic proto import failed",
        lastInitError: "Proto import returned false",
        rithmicModeDetected: cfg.mode,
      });
    }

    const { validateProtos } = await import("../brokers/rithmic/codec");
    const validation = await validateProtos();

    if (!validation.valid) {
      const errMsg = `Proto validation failed: ${validation.errors.join(", ")}`;
      console.warn(`[AdapterFactory] ${errMsg}`);
      console.warn("[AdapterFactory] Falling back to mock adapter");
      return mockResult({
        reason: "Proto validation failed",
        lastInitError: errMsg,
        rithmicModeDetected: cfg.mode,
      });
    }

    const { RithmicProtocolAdapter } = await import("../brokers/rithmic/RithmicProtocolAdapter");

    const adapterConfig: Record<string, unknown> = {
      systemName: cfg.systemName,
      userId: cfg.userId,
      password: cfg.password,
      appName: "VCPTrader",
      appVersion: "1.0.0",
      fcmId: process.env.RITHMIC_FCM_ID,
      ibId: process.env.RITHMIC_IB_ID,
      accountId: process.env.RITHMIC_ACCOUNT_ID,
    };

    if (cfg.mode === "protocol") {
      adapterConfig.wsUrl = cfg.wsUrl;
      adapterConfig.tickerPlantUri = cfg.wsUrl!;
      adapterConfig.orderPlantUri = cfg.wsUrl!;
    } else {
      adapterConfig.tickerPlantUri = cfg.tickerPlantUri!;
      adapterConfig.orderPlantUri = cfg.orderPlantUri!;
    }

    const adapter = new RithmicProtocolAdapter(adapterConfig as any);

    const modeLabel = cfg.mode === "protocol" ? "Protocol Server" : "Plant";
    const detail = `${cfg.systemName} / ${cfg.userId} (${modeLabel})`;
    console.log(`[AdapterFactory] Rithmic adapter created successfully (${modeLabel} mode)`);

    return {
      adapter,
      feedType: "rithmic",
      feedDetail: detail,
      rithmicModeDetected: cfg.mode,
      missingEnvVars: [],
      lastInitError: null,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[AdapterFactory] Rithmic adapter creation failed:", errMsg);
    console.warn("[AdapterFactory] Falling back to mock adapter");
    return mockResult({
      reason: `Rithmic init error: ${errMsg}`,
      lastInitError: errMsg,
      rithmicModeDetected: cfg.mode,
    });
  }
}
