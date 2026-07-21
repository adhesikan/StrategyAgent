// Twelve Data / daily market data configuration.
// Environment variables are the FINAL safety control: a permissive database
// value can never override a restrictive environment setting.

export type LicenseMode = "disabled" | "prelaunch" | "external";

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function getTwelveDataConfig() {
  const rawMode = (process.env.TWELVE_DATA_LICENSE_MODE || "prelaunch").toLowerCase();
  const licenseMode: LicenseMode =
    rawMode === "external" ? "external" : rawMode === "disabled" ? "disabled" : "prelaunch";

  return {
    provider: "twelve_data" as const,
    apiKey: process.env.TWELVE_DATA_API_KEY || "",
    enabled: (process.env.TWELVE_DATA_ENABLED ?? "true").toLowerCase() !== "false",
    licenseMode,
    externalDisplayEnabled:
      (process.env.TWELVE_DATA_EXTERNAL_DISPLAY_ENABLED || "false").toLowerCase() === "true",
    creditsPerMinute: envInt("TWELVE_DATA_API_CREDITS_PER_MINUTE", 8),
    dailyCreditLimit: envInt("TWELVE_DATA_DAILY_CREDIT_LIMIT", 800),
    minuteSafetyLimit: envInt("TWELVE_DATA_MINUTE_SAFETY_LIMIT", 7),
    dailySafetyLimit: envInt("TWELVE_DATA_DAILY_SAFETY_LIMIT", 750),
    interval: process.env.TWELVE_DATA_INTERVAL || "1day",
    timezone: process.env.TWELVE_DATA_TIMEZONE || "America/New_York",
    maxRetries: envInt("TWELVE_DATA_MAX_RETRIES", 2),
    requestTimeoutMs: envInt("TWELVE_DATA_REQUEST_TIMEOUT_MS", 15000),
    defaultOutputSize: envInt("TWELVE_DATA_DEFAULT_OUTPUT_SIZE", 5000),
    internalUserEmails: (process.env.TWELVE_DATA_INTERNAL_USER_EMAILS || "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
    attributionEnabled:
      (process.env.TWELVE_DATA_ATTRIBUTION_ENABLED ?? "true").toLowerCase() !== "false",
    environment: process.env.NODE_ENV === "production" ? "production" : "development",
  };
}

/** Trial Daily Analysis Mode product configuration (license flags above remain the final legal gate). */
export function getTrialDailyAnalysisConfig() {
  return {
    enabled: (process.env.TRIAL_DAILY_ANALYSIS_ENABLED ?? "true").toLowerCase() !== "false",
    symbolLimit: envInt("TRIAL_DAILY_ANALYSIS_SYMBOL_LIMIT", 20),
    watchlistLimit: envInt("TRIAL_DAILY_ANALYSIS_WATCHLIST_LIMIT", 10),
    savedCandidateLimit: envInt("TRIAL_SAVED_CANDIDATE_LIMIT", 20),
    radarResultLimit: envInt("TRIAL_OPPORTUNITY_RADAR_RESULT_LIMIT", 5),
    requireNoBrokerConnection:
      (process.env.TRIAL_REQUIRE_NO_BROKER_CONNECTION || "false").toLowerCase() === "true",
  };
}

/** Remove the API key from any string (URLs, error messages) before logging. */
export function redactApiKey(input: string): string {
  const key = process.env.TWELVE_DATA_API_KEY;
  let out = input.replace(/apikey=[^&\s"']+/gi, "apikey=REDACTED");
  if (key && key.length > 3) out = out.split(key).join("REDACTED");
  return out;
}

/** True when any Twelve Data API calls / ingestion are permitted at all. */
export function isIngestionAllowed(): boolean {
  const cfg = getTwelveDataConfig();
  return cfg.enabled && cfg.licenseMode !== "disabled" && !!cfg.apiKey;
}
