export type MarketingEvent =
  | "start_free_trial_clicked"
  | "see_how_it_works_clicked"
  | "explore_paper_mode_clicked"
  | "pricing_plan_selected"
  | "onboarding_completed"
  | "broker_connect_clicked";

export function track(event: MarketingEvent, props: Record<string, unknown> = {}): void {
  try {
    const w = window as unknown as {
      dataLayer?: Array<Record<string, unknown>>;
      gtag?: (cmd: string, eventName: string, params?: Record<string, unknown>) => void;
      analytics?: { track?: (event: string, props?: Record<string, unknown>) => void };
    };
    if (w.dataLayer) w.dataLayer.push({ event, ...props });
    if (typeof w.gtag === "function") w.gtag("event", event, props);
    if (w.analytics?.track) w.analytics.track(event, props);
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.debug("[analytics]", event, props);
    }
  } catch {
    // analytics must never break the UI
  }
}

const STORAGE_KEY = "sa.marketingOnboarding";

export interface MarketingOnboardingPrefs {
  trades: "stocks" | "options" | "both";
  style: "options_income" | "swing" | "momentum" | "day";
  riskComfort: "conservative" | "moderate" | "aggressive";
  instruments: string[];
  completedAt: string;
}

export function saveMarketingOnboarding(prefs: MarketingOnboardingPrefs): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {}
}

export function loadMarketingOnboarding(): MarketingOnboardingPrefs | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as MarketingOnboardingPrefs) : null;
  } catch {
    return null;
  }
}
