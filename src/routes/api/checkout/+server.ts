/**
 * Stripe Checkout API Endpoint
 * 
 * Creates a Stripe Checkout Session for single product purchases.
 * POST /api/checkout with { productId, title, price, image }
 */

import { json, error } from '@sveltejs/kit';
import Stripe from 'stripe';
import { STRIPE_SECRET_KEY } from '$env/static/private';
import { PUBLIC_SITE_URL } from '$env/static/public';

const stripe = new Stripe(STRIPE_SECRET_KEY);

export async function POST({ request }) {
  try {
    const body = await request.json();
    console.log('Received checkout request:', JSON.stringify(body, null, 2));
    
    const { productId, title, price, image } = body;

    // Validate required fields
    if (!productId || !title || !price) {
      console.log('Missing fields - productId:', productId, 'title:', title, 'price:', price);
      throw error(400, 'Missing required fields: productId, title, price');
    }

    // Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: title,
              images: image ? [image] : [],
            },
            unit_amount: Math.round(price * 100), // Stripe uses cents
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${PUBLIC_SITE_URL}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${PUBLIC_SITE_URL}/checkout/cancel`,
      metadata: {
        productId,
      },
    });

    return json({ sessionId: session.id, url: session.url });
  } catch (err: any) {
    console.error('Stripe checkout error:', err?.message || err);
    console.error('Full error:', JSON.stringify(err, null, 2));
    throw error(500, err?.message || 'Failed to create checkout session');
  }
}
