/**
 * Stripe Webhook Handler
 * 
 * Listens for Stripe events and triggers email notifications.
 * This runs when payments are completed, refunded, etc.
 * 
 * Key Security: Stripe signature verification prevents fake webhooks.
 */

import { json, error } from '@sveltejs/kit';
import Stripe from 'stripe';
import { Resend } from 'resend';
import { STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, RESEND_API_KEY } from '$env/static/private';

const stripe = new Stripe(STRIPE_SECRET_KEY);
const resend = new Resend(RESEND_API_KEY);

export async function POST({ request }) {
  const body = await request.text();
  const signature = request.headers.get('stripe-signature');

  if (!signature) {
    console.error('Missing stripe-signature header');
    throw error(400, 'Missing stripe-signature header');
  }

  let event: Stripe.Event;

  try {
    // Verify the webhook signature for security
    event = stripe.webhooks.constructEvent(body, signature, STRIPE_WEBHOOK_SECRET);
  } catch (err: any) {
    console.error('Webhook signature verification failed:', err.message);
    throw error(400, `Webhook Error: ${err.message}`);
  }

  console.log(`Received webhook: ${event.type}`);

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        await handleCheckoutCompleted(session);
        break;
      }
      
      // Add more event types as needed
      case 'payment_intent.payment_failed': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        console.log('Payment failed:', paymentIntent.id);
        // Could send failure notification email here
        break;
      }
      
      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return json({ received: true });

  } catch (err) {
    console.error('Error processing webhook:', err);
    throw error(500, 'Webhook processing failed');
  }
}

/**
 * Handle completed checkout sessions
 * Sends confirmation email to customer and notification to admin
 */
async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  console.log('Processing completed checkout:', session.id);

  try {
    // Fetch full session data with expanded fields
    const fullSession = await stripe.checkout.sessions.retrieve(session.id, {
      expand: ['line_items', 'customer_details', 'shipping_details']
    });

    const customerEmail = fullSession.customer_details?.email;
    const shippingDetails = fullSession.shipping_details;
    const lineItems = fullSession.line_items?.data || [];

    if (!customerEmail) {
      console.error('No customer email found for session:', session.id);
      return;
    }

    // Send customer confirmation email
    await sendCustomerConfirmation({
      session: fullSession,
      customerEmail,
      shippingDetails,
      lineItems
    });

    // Send admin notification email
    await sendAdminNotification({
      session: fullSession,
      customerEmail,
      shippingDetails,
      lineItems
    });

    console.log('Emails sent successfully for session:', session.id);

  } catch (err) {
    console.error('Error in handleCheckoutCompleted:', err);
    throw err;
  }
}

/**
 * Send order confirmation to customer
 */
async function sendCustomerConfirmation({ session, customerEmail, shippingDetails, lineItems }: {
  session: Stripe.Checkout.Session;
  customerEmail: string;
  shippingDetails: Stripe.Checkout.Session.ShippingDetails | null;
  lineItems: Stripe.LineItem[];
}) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount / 100);
  };

  const itemsList = lineItems.map(item => 
    `• ${item.description} (${item.quantity}x) - ${formatCurrency(item.amount_total)}`
  ).join('\n');

  const shippingAddress = shippingDetails?.address ? `
${shippingDetails.name}
${shippingDetails.address.line1}
${shippingDetails.address.line2 || ''}
${shippingDetails.address.city}, ${shippingDetails.address.state} ${shippingDetails.address.postal_code}
${shippingDetails.address.country}`.trim() : 'No shipping address';

  const emailContent = `
Hi ${shippingDetails?.name || 'there'},

Thank you for your order! Your payment has been successfully processed.

ORDER DETAILS
Order ID: ${session.id}
Total: ${formatCurrency(session.amount_total || 0)}

ITEMS ORDERED
${itemsList}

SHIPPING ADDRESS
${shippingAddress}

WHAT'S NEXT?
• Your order will be processed within 1-2 business days
• Made-to-order prints typically ship within 2 weeks
• You'll receive tracking information once your order ships
• If you have any questions, just reply to this email

Thank you for supporting Angel's Rest!

Best regards,
Jesse Pomeroy
Angel's Rest
https://angelsrest.online
  `.trim();

  await resend.emails.send({
    from: 'Angel\'s Rest <orders@angelsrest.online>',
    to: [customerEmail],
    subject: `Order Confirmation - ${session.id}`,
    text: emailContent,
  });
}

/**
 * Send order notification to admin (you)
 */
async function sendAdminNotification({ session, customerEmail, shippingDetails, lineItems }: {
  session: Stripe.Checkout.Session;
  customerEmail: string;
  shippingDetails: Stripe.Checkout.Session.ShippingDetails | null;
  lineItems: Stripe.LineItem[];
}) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount / 100);
  };

  const itemsList = lineItems.map(item => 
    `• ${item.description} (${item.quantity}x) - ${formatCurrency(item.amount_total)}`
  ).join('\n');

  const shippingAddress = shippingDetails?.address ? `
${shippingDetails.name}
${shippingDetails.address.line1}
${shippingDetails.address.line2 || ''}
${shippingDetails.address.city}, ${shippingDetails.address.state} ${shippingDetails.address.postal_code}
${shippingDetails.address.country}`.trim() : 'No shipping address';

  const emailContent = `
🎉 NEW ORDER RECEIVED!

ORDER DETAILS
Order ID: ${session.id}
Customer: ${customerEmail}
Total: ${formatCurrency(session.amount_total || 0)}
Payment Status: ${session.payment_status}

ITEMS TO FULFILL
${itemsList}

SHIP TO
${shippingAddress}

STRIPE DASHBOARD
View full details: https://dashboard.stripe.com/payments/${session.payment_intent}

---
This order was automatically processed through your Angel's Rest website.
  `.trim();

  await resend.emails.send({
    from: 'Angel\'s Rest Orders <orders@angelsrest.online>',
    to: ['thinkingofview@gmail.com'],
    subject: `🛒 New Order: ${formatCurrency(session.amount_total || 0)} from ${shippingDetails?.name || customerEmail}`,
    text: emailContent,
  });
}