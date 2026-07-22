import { getUncachableStripeClient } from '../server/stripeClient';

async function seedProPlan() {
  const stripe = await getUncachableStripeClient();

  let productId: string;
  const existing = await stripe.products.search({ query: "name:'VCP Trader AI Pro'" });
  if (existing.data.length > 0) {
    productId = existing.data[0].id;
    console.log('Product already exists:', productId);
  } else {
    const product = await stripe.products.create({
      name: 'VCP Trader AI Pro',
      description:
        'AI-powered stock and options research, strategy analysis, broker-connected market data, and self-directed order review and submission.',
      metadata: { planId: 'pro' },
    });
    productId = product.id;
    console.log('Created product:', productId);
  }

  const prices = await stripe.prices.list({ product: productId, active: true, limit: 100 });
  let monthly = prices.data.find(
    (p) => p.recurring?.interval === 'month' && p.unit_amount === 9900 && p.currency === 'usd',
  );
  if (monthly) {
    console.log('Monthly price already exists:', monthly.id);
  } else {
    monthly = await stripe.prices.create({
      product: productId,
      unit_amount: 9900,
      currency: 'usd',
      recurring: { interval: 'month' },
      metadata: { planId: 'pro', cycle: 'monthly' },
    });
    console.log('Created monthly price:', monthly.id, '- $99/month');
  }

  console.log('RESULT_PRICE_ID=' + monthly.id);
}

seedProPlan().catch((err) => {
  console.error(err);
  process.exit(1);
});
