/**
 * Success Page Data Loader
 * 
 * Fetches order details from Stripe to display shipping info and order summary.
 * This runs server-side, so we can safely use the Stripe secret key.
 */

import Stripe from 'stripe';
import { STRIPE_SECRET_KEY } from '$env/static/private';
import { error } from '@sveltejs/kit';

const stripe = new Stripe(STRIPE_SECRET_KEY);

export async function load({ url }) {
  const sessionId = url.searchParams.get('session_id');
  
  // If no session ID, just show basic success page
  if (!sessionId) {
    return {
      orderDetails: null
    };
  }

  try {
    // Fetch the checkout session with expanded data
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['line_items', 'customer_details', 'shipping_cost', 'shipping_details']
    });

    // Transform Stripe data into our format
    const orderDetails = {
      sessionId: session.id,
      customerEmail: session.customer_details?.email,
      amountTotal: session.amount_total,
      currency: session.currency,
      paymentStatus: session.payment_status,
      
      // Shipping information
      shippingAddress: session.shipping_details?.address ? {
        name: session.shipping_details.name,
        line1: session.shipping_details.address.line1,
        line2: session.shipping_details.address.line2,
        city: session.shipping_details.address.city,
        state: session.shipping_details.address.state,
        postalCode: session.shipping_details.address.postal_code,
        country: session.shipping_details.address.country,
      } : null,
      
      // Line items (what they bought)
      items: session.line_items?.data.map(item => ({
        description: item.description,
        quantity: item.quantity,
        amount: item.amount_total
      })) || [],
      
      // Metadata
      productId: session.metadata?.productId,
    };

    return {
      orderDetails
    };

  } catch (err) {
    console.error('Error fetching order details:', err);
    // Don't break the success page if Stripe lookup fails
    return {
      orderDetails: null,
      error: 'Could not load order details'
    };
  }
}