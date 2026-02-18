import { getUncachableStripeClient } from '../server/stripeClient';

async function seedPartnerSubscriptionProduct() {
  const stripe = await getUncachableStripeClient();

  const products = await stripe.products.search({ query: "name:'Auto Trading Subscription'" });
  if (products.data.length > 0) {
    console.log('Auto Trading Subscription product already exists:', products.data[0].id);
    const prices = await stripe.prices.list({ product: products.data[0].id, active: true });
    console.log('Existing prices:', prices.data.map(p => `${p.id} - $${(p.unit_amount || 0) / 100}/${p.recurring?.interval}`));
    return;
  }

  const product = await stripe.products.create({
    name: 'Auto Trading Subscription',
    description: 'Automated trade execution from partner signals. Includes broker connectivity, agent configuration, and real-time trade execution.',
    metadata: {
      type: 'partner_subscription',
    },
  });
  console.log('Created product:', product.id);

  const monthlyPrice = await stripe.prices.create({
    product: product.id,
    unit_amount: 3900,
    currency: 'usd',
    recurring: { interval: 'month' },
    metadata: {
      type: 'partner_subscription_monthly',
    },
  });
  console.log('Created monthly price:', monthlyPrice.id, '- $39/month');
}

seedPartnerSubscriptionProduct().catch(console.error);
