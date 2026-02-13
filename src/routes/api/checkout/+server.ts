/**
 * Stripe Checkout API Endpoint - The Heart of E-commerce
 * 
 * This server-side endpoint creates Stripe Checkout Sessions for secure payment processing.
 * Understanding this pattern is crucial for any e-commerce application.
 * 
 * Key Learning Points:
 * 1. Server-side API routes in SvelteKit use +server.ts files
 * 2. Environment variables keep secrets secure (never expose API keys to client)
 * 3. Stripe Checkout handles the complex PCI compliance for us
 * 4. Always validate input data before processing payments
 * 5. Proper error handling prevents failed payments from breaking UX
 * 
 * POST /api/checkout with { productId, title, price, image }
 * Returns { sessionId, url } for client-side redirect
 */

import { json, error } from '@sveltejs/kit';
import Stripe from 'stripe';
import { STRIPE_SECRET_KEY } from '$env/static/private';
import { PUBLIC_SITE_URL } from '$env/static/public';

/**
 * Initialize Stripe with Secret Key
 * 
 * Why server-side only?
 * - Secret keys have full access to your Stripe account
 * - Client-side code is visible to anyone (View Source)
 * - Server-side code runs in a secure environment
 * 
 * The 'stripe' package is for server-side use only.
 * Client-side uses '@stripe/stripe-js' with publishable keys.
 */
const stripe = new Stripe(STRIPE_SECRET_KEY);

/**
 * HTTP POST Handler
 * 
 * SvelteKit API routes export named functions for HTTP methods.
 * This function runs on your server when someone POSTs to /api/checkout.
 * 
 * The { request } parameter contains the incoming HTTP request data.
 */
export async function POST({ request }) {
  try {
    /**
     * Parse and Validate Request Body
     * 
     * request.json() parses the JSON body sent from the client.
     * We immediately destructure the expected fields for clarity.
     * 
     * Why validate?
     * - Prevents malformed data from reaching Stripe
     * - Gives clear error messages to developers
     * - Prevents potential security issues
     */
    const body = await request.json();
    console.log('Received checkout request:', JSON.stringify(body, null, 2));
    
    const { productId, title, price, image } = body;

    /**
     * Input Validation
     * 
     * Never trust client data! Even if your own frontend sends it.
     * - Users can modify requests via dev tools
     * - Malicious actors can send direct API calls
     * - Better to fail fast with clear errors than mysterious Stripe errors
     */
    if (!productId || !title || !price) {
      console.log('Missing fields - productId:', productId, 'title:', title, 'price:', price);
      throw error(400, 'Missing required fields: productId, title, price');
    }

    /**
     * Create Stripe Checkout Session
     * 
     * This is where the magic happens! Stripe's Checkout Session API:
     * 1. Creates a secure payment page hosted by Stripe
     * 2. Handles all payment methods (cards, digital wallets, etc.)
     * 3. Manages PCI compliance for us
     * 4. Returns URLs for success/cancel redirects
     * 
     * Key Configuration Choices:
     */
    const session = await stripe.checkout.sessions.create({
      /**
       * Payment Methods
       * 
       * ['card'] is the most universal, but Stripe supports many others:
       * - 'apple_pay', 'google_pay' (digital wallets)
       * - 'klarna', 'afterpay' (buy now, pay later)
       * - 'us_bank_account' (ACH transfers)
       * 
       * Start simple, add more as your business grows.
       */
      payment_method_types: ['card'],
      
      /**
       * Line Items - What They're Buying
       * 
       * Using price_data instead of pre-created Price objects gives flexibility.
       * Good for dynamic pricing, custom products, or rapid prototyping.
       * 
       * For recurring products, create Price objects in Stripe Dashboard instead.
       */
      line_items: [
        {
          price_data: {
            currency: 'usd', // ISO currency code
            product_data: {
              name: title,
              images: image ? [image] : [], // Stripe shows product images in checkout
            },
            /**
             * Critical: Stripe Uses Cents!
             * 
             * $19.99 = 1999 cents
             * Always multiply by 100 and round to avoid floating point errors.
             * Math.round() handles edge cases like $19.999 → 1999
             */
            unit_amount: Math.round(price * 100),
          },
          quantity: 1, // Fixed quantity for "Buy Now" pattern
        },
      ],
      
      /**
       * Session Mode
       * 
       * 'payment' = one-time payment (what we want)
       * 'subscription' = recurring billing
       * 'setup' = save payment method without charging
       */
      mode: 'payment',
      
      /**
       * Redirect URLs - Critical for User Experience
       * 
       * {CHECKOUT_SESSION_ID} is a Stripe template variable.
       * Stripe replaces it with the actual session ID when redirecting.
       * Our success page can use this to show order details.
       */
      success_url: `${PUBLIC_SITE_URL}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${PUBLIC_SITE_URL}/checkout/cancel`,
      
      /**
       * Metadata - Your Data, Attached to Stripe Objects
       * 
       * Stripe stores this with the session/payment for your reference.
       * Perfect for order IDs, user IDs, inventory tracking, etc.
       * Accessible in webhooks for post-purchase automation.
       */
      metadata: {
        productId, // Track which product was purchased
      },
    });

    /**
     * Return Session Data to Client
     * 
     * The client needs:
     * - sessionId: For Stripe.js redirect
     * - url: Direct redirect URL (we use this approach)
     * 
     * Alternative: Return sessionId and use Stripe.js redirectToCheckout()
     */
    return json({ sessionId: session.id, url: session.url });
    
  } catch (err: any) {
    /**
     * Error Handling Best Practices
     * 
     * 1. Log detailed errors for debugging (server-side only)
     * 2. Return safe, generic errors to clients (don't expose internals)
     * 3. Use appropriate HTTP status codes
     * 
     * Common Stripe errors:
     * - Invalid API keys (401)
     * - Rate limiting (429)
     * - Invalid parameters (400)
     */
    console.error('Stripe checkout error:', err?.message || err);
    console.error('Full error:', JSON.stringify(err, null, 2));
    
    // Return user-friendly error while keeping details private
    throw error(500, err?.message || 'Failed to create checkout session');
  }
}

/**
 * Security Considerations Checklist:
 * 
 * ✅ Secret keys stored in environment variables
 * ✅ Input validation prevents malformed requests
 * ✅ Server-side processing prevents client manipulation
 * ✅ Stripe handles PCI compliance
 * ✅ Error messages don't expose sensitive data
 * 
 * Next Steps for Production:
 * 1. Add webhook handling for order fulfillment
 * 2. Implement inventory management
 * 3. Add customer database integration
 * 4. Set up monitoring and alerting
 * 5. Test with Stripe's test cards thoroughly
 */