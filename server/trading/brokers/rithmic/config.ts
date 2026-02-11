export type RithmicMode = "protocol" | "plant";

export interface RithmicConfigResolved {
  mode: RithmicMode;
  wsUrl?: string;
  tickerPlantUri?: string;
  orderPlantUri?: string;
  systemName: string;
  userId: string;
  password: string;
  missing: string[];
}

export function resolveRithmicConfig(env: Record<string, string | undefined>): RithmicConfigResolved {
  const missing: string[] = [];

  const systemName = env.RITHMIC_SYSTEM_NAME ?? "Rithmic Test";
  const userId = env.RITHMIC_USER_ID ?? "";
  const password = env.RITHMIC_PASSWORD ?? "";

  if (!userId) missing.push("RITHMIC_USER_ID");
  if (!password) missing.push("RITHMIC_PASSWORD");

  const wsUrl = env.RITHMIC_WS_URL;
  const tickerPlantUri = env.RITHMIC_TICKER_PLANT_URI;
  const orderPlantUri = env.RITHMIC_ORDER_PLANT_URI;

  if (wsUrl) {
    return {
      mode: "protocol",
      wsUrl,
      systemName,
      userId,
      password,
      missing,
    };
  }

  if (tickerPlantUri && orderPlantUri) {
    return {
      mode: "plant",
      tickerPlantUri,
      orderPlantUri,
      systemName,
      userId,
      password,
      missing,
    };
  }

  if (tickerPlantUri && !orderPlantUri) {
    missing.push("RITHMIC_ORDER_PLANT_URI");
  } else if (!tickerPlantUri && orderPlantUri) {
    missing.push("RITHMIC_TICKER_PLANT_URI");
  } else {
    missing.push("RITHMIC_WS_URL or (RITHMIC_TICKER_PLANT_URI + RITHMIC_ORDER_PLANT_URI)");
  }

  return {
    mode: "protocol",
    systemName,
    userId,
    password,
    missing,
  };
}
