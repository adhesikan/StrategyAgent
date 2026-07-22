// Founding vs standard pricing control.
//
// The founding-member price ($99/mo) is offered until FOUNDING_PRICING_ENDS_AT
// (ISO date, e.g. "2026-10-01" or "2026-10-01T00:00:00Z"). After that moment,
// new checkouts use the standard price ($149/mo) and the UI stops advertising
// the founding price. Existing subscribers are unaffected — their Stripe
// subscription keeps whatever price they signed up with.
//
// Env vars:
// - STRIPE_PRO_MONTHLY_PRICE_ID          → founding price ($99/mo)
// - STRIPE_PRO_STANDARD_MONTHLY_PRICE_ID → standard price ($149/mo)
// - FOUNDING_PRICING_ENDS_AT             → optional cutoff; unset = founding
//   pricing stays active indefinitely (pre-launch / launch window).

export interface PublicPricing {
  foundingActive: boolean;
  foundingEndsAt: string | null;
  monthlyPrice: number;
  standardMonthlyPrice: number;
}

const FOUNDING_MONTHLY_PRICE = 99;
const STANDARD_MONTHLY_PRICE = 149;

function parseFoundingEndsAt(): Date | null {
  const raw = process.env.FOUNDING_PRICING_ENDS_AT?.trim();
  if (!raw) return null;
  const d = new Date(raw);
  if (isNaN(d.getTime())) {
    console.warn(
      `[pricing] FOUNDING_PRICING_ENDS_AT is not a valid date: "${raw}" — treating founding pricing as still active`,
    );
    return null;
  }
  return d;
}

export function isFoundingPricingActive(now: Date = new Date()): boolean {
  const endsAt = parseFoundingEndsAt();
  if (!endsAt) return true;
  return now < endsAt;
}

export function getPublicPricing(): PublicPricing {
  const endsAt = parseFoundingEndsAt();
  return {
    foundingActive: isFoundingPricingActive(),
    foundingEndsAt: endsAt ? endsAt.toISOString() : null,
    monthlyPrice: isFoundingPricingActive() ? FOUNDING_MONTHLY_PRICE : STANDARD_MONTHLY_PRICE,
    standardMonthlyPrice: STANDARD_MONTHLY_PRICE,
  };
}

/**
 * Returns the Stripe price ID new pro/monthly checkouts should use, honoring
 * the founding-pricing window. Fail-closed: once founding pricing has ended,
 * the founding price must never be sold again — if the standard price ID is
 * missing, checkout errors instead of silently charging the founding price.
 */
export function getActiveProMonthlyPriceId(): string | null {
  const founding = process.env.STRIPE_PRO_MONTHLY_PRICE_ID || null;
  const standard = process.env.STRIPE_PRO_STANDARD_MONTHLY_PRICE_ID || null;
  if (isFoundingPricingActive()) return founding;
  if (!standard) {
    console.error(
      "[pricing] Founding pricing has ended but STRIPE_PRO_STANDARD_MONTHLY_PRICE_ID is not set — refusing to sell the founding price",
    );
    return null;
  }
  return standard;
}

/** Price ID → known pro monthly tier, for webhook reconciliation. */
export function isProMonthlyPriceId(priceId: string): boolean {
  return (
    priceId === process.env.STRIPE_PRO_MONTHLY_PRICE_ID ||
    priceId === process.env.STRIPE_PRO_STANDARD_MONTHLY_PRICE_ID
  );
}
