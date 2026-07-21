import Stripe from "stripe";
import { db } from "../../db";
import { users as usersTable } from "@shared/models/auth";
import { eq } from "drizzle-orm";
import { getUncachableStripeClient } from "../../stripeClient";
import { PLANS, isPlanId, type PlanId } from "@shared/plans";

export type BillingCycle = "monthly" | "annual";

export function getPriceId(planId: PlanId, cycle: BillingCycle): string | null {
  const plan = PLANS[planId];
  if (!plan) return null;
  return cycle === "annual" ? plan.stripeAnnualPriceId : plan.stripeMonthlyPriceId;
}

function getAppBaseUrl(): string {
  if (process.env.APP_URL) return process.env.APP_URL;
  const domain = process.env.REPLIT_DOMAINS?.split(",")[0];
  if (domain) return `https://${domain}`;
  return "http://localhost:5000";
}

async function getOrCreateCustomer(userId: string, email?: string | null): Promise<string> {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) throw new Error("User not found");

  if (user.stripeCustomerId) return user.stripeCustomerId;

  const stripe = await getUncachableStripeClient();
  const customer = await stripe.customers.create({
    email: email ?? user.email ?? undefined,
    metadata: { userId },
  });

  await db
    .update(usersTable)
    .set({ stripeCustomerId: customer.id, updatedAt: new Date() })
    .where(eq(usersTable.id, userId));

  return customer.id;
}

export async function createCheckoutSession(
  userId: string,
  planId: PlanId,
  cycle: BillingCycle,
  email?: string | null,
): Promise<{ url: string }> {
  if (planId === "free") throw new Error("Cannot checkout for free plan");
  const priceId = getPriceId(planId, cycle);
  if (!priceId) {
    throw new Error(`Stripe price ID not configured for plan=${planId} cycle=${cycle}`);
  }

  const stripe = await getUncachableStripeClient();
  const customerId = await getOrCreateCustomer(userId, email);
  const baseUrl = getAppBaseUrl();

  // Never grant a second trial. If the user has an app-started trial still
  // running, carry over only the remaining days; if their trial was already
  // used or has ended, checkout starts a paid subscription immediately.
  const [userRow] = await db
    .select({ trialEndsAt: usersTable.trialEndsAt })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  let trialDays: number | undefined;
  if (!userRow?.trialEndsAt) {
    trialDays = 14;
  } else {
    const msLeft = userRow.trialEndsAt.getTime() - Date.now();
    const daysLeft = Math.ceil(msLeft / (24 * 60 * 60 * 1000));
    trialDays = daysLeft >= 1 ? Math.min(14, daysLeft) : undefined;
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${baseUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/billing/cancel`,
    subscription_data: {
      ...(trialDays ? { trial_period_days: trialDays } : {}),
      metadata: { userId, planId, cycle },
    },
    metadata: { userId, planId, cycle },
    allow_promotion_codes: true,
  });

  if (!session.url) throw new Error("Stripe did not return a checkout URL");
  return { url: session.url };
}

/**
 * Fetches the live subscription from Stripe and syncs the user's plan record.
 * Used as a fallback when webhooks are delayed or missed.
 */
export async function reconcileSubscriptionForUser(
  userId: string,
  subscriptionId: string,
): Promise<void> {
  const stripe = await getUncachableStripeClient();
  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  await applySubscriptionToUser(userId, sub);
}

export async function createPortalSession(userId: string): Promise<{ url: string }> {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) throw new Error("User not found");
  if (!user.stripeCustomerId) {
    throw new Error("No Stripe customer on file. Subscribe first to manage billing.");
  }

  const stripe = await getUncachableStripeClient();
  const baseUrl = getAppBaseUrl();
  const session = await stripe.billingPortal.sessions.create({
    customer: user.stripeCustomerId,
    return_url: `${baseUrl}/settings`,
  });
  return { url: session.url };
}

function planIdFromPrice(priceId: string | null | undefined): PlanId | null {
  if (!priceId) return null;
  for (const id of Object.keys(PLANS) as PlanId[]) {
    const plan = PLANS[id];
    if (plan.stripeMonthlyPriceId === priceId || plan.stripeAnnualPriceId === priceId) {
      return id;
    }
  }
  return null;
}

function cycleFromPrice(priceId: string | null | undefined): BillingCycle {
  if (!priceId) return "monthly";
  for (const id of Object.keys(PLANS) as PlanId[]) {
    if (PLANS[id].stripeAnnualPriceId === priceId) return "annual";
  }
  return "monthly";
}

async function applySubscriptionToUser(
  userId: string,
  subscription: Stripe.Subscription,
): Promise<void> {
  const item = subscription.items?.data?.[0];
  const priceId = item?.price?.id ?? null;
  const planId = planIdFromPrice(priceId)
    ?? (isPlanId(subscription.metadata?.planId) ? (subscription.metadata!.planId as PlanId) : null)
    ?? "free";
  const cycle = cycleFromPrice(priceId);

  const status = subscription.status;
  const trialEndsAt = subscription.trial_end ? new Date(subscription.trial_end * 1000) : null;
  const currentPeriodEnd = (subscription as any).current_period_end;
  const periodEnd = typeof currentPeriodEnd === "number" ? new Date(currentPeriodEnd * 1000) : null;

  // Cancelled / unpaid → revert to free; otherwise honour selected plan.
  const effectivePlan: PlanId =
    status === "canceled" || status === "incomplete_expired" || status === "unpaid"
      ? "free"
      : planId;

  await db
    .update(usersTable)
    .set({
      planId: effectivePlan,
      billingCycle: cycle,
      subscriptionStatus: status,
      stripeSubscriptionId: subscription.id,
      trialEndsAt,
      currentPeriodEndsAt: periodEnd,
      updatedAt: new Date(),
    })
    .where(eq(usersTable.id, userId));
}

async function findUserIdForCustomer(customerId: string, fallbackMeta?: string | null): Promise<string | null> {
  if (fallbackMeta) return fallbackMeta;
  const [user] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.stripeCustomerId, customerId))
    .limit(1);
  return user?.id ?? null;
}

/**
 * Handles plan-related Stripe events. Safe to no-op for unrelated events
 * (the partner webhook handler at /api/stripe/webhook handles its own events).
 */
export async function handlePlanWebhook(payload: Buffer, signature: string): Promise<void> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error("STRIPE_WEBHOOK_SECRET is not configured");
  }
  const stripe = await getUncachableStripeClient();
  const event = stripe.webhooks.constructEvent(payload, signature, secret);

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = (session.metadata?.userId as string | undefined)
        ?? await findUserIdForCustomer(String(session.customer ?? ""), null);
      if (!userId || !session.subscription) return;
      const subId = typeof session.subscription === "string" ? session.subscription : session.subscription.id;
      const sub = await stripe.subscriptions.retrieve(subId);
      await applySubscriptionToUser(userId, sub);
      return;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
      const userId = await findUserIdForCustomer(customerId, sub.metadata?.userId ?? null);
      if (!userId) return;
      await applySubscriptionToUser(userId, sub);
      return;
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
      if (!customerId) return;
      const userId = await findUserIdForCustomer(customerId, null);
      if (!userId) return;
      await db
        .update(usersTable)
        .set({ subscriptionStatus: "past_due", updatedAt: new Date() })
        .where(eq(usersTable.id, userId));
      return;
    }
    default:
      return;
  }
}
