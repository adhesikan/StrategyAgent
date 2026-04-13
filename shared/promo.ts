// Single source of truth for promo configuration
// Jan 30, 2026 11:59:59.999 PM America/New_York = Jan 31, 2026 04:59:59.999 UTC
export const PROMO_END_ISO = "2026-01-31T04:59:59.999Z";
export const PROMO_CODE = "EARLYBIRD50";
export const TRIAL_DAYS = 14;

export const PROMO_CONFIG = {
  standardPrice: 99,
  promoPrice: 49,
  discountPercent: 50,
  planName: "Strategy Agent Pro",
  endDateDisplay: "Jan 30, 2026",
  trialDays: TRIAL_DAYS,
};

export function isPromoActive(): boolean {
  return Date.now() < new Date(PROMO_END_ISO).getTime();
}

export function getPromoEndDate(): Date {
  return new Date(PROMO_END_ISO);
}
