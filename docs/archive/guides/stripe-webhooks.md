# Archived: Stripe webhooks guide

> Historical educational material. The current webhook is Convex-backed and
> supports Stripe Connect, invoice settlement, and LumaPrints orchestration.
> See [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) for the live boundaries.

A complete guide to understanding and implementing Stripe webhooks for automated email notifications when customers complete purchases.

## What Are Webhooks?

**Webhooks are HTTP callbacks** that Stripe sends to your server when events happen in your Stripe account. Think of them as "push notifications" for your server.

**Why do we need them?**
- **Real-time automation** — Send emails instantly when payments complete
- **Reliability** — Even if your checkout page crashes, webhooks still fire
- **Server-side security** — Handle sensitive operations (like email sending) safely on your server
- **Event completeness** — Get the full payment data, not just what the client knows

**The flow:**
1. Customer completes checkout on your site
2. Stripe processes the payment
3. Stripe immediately sends a webhook to your server: "Hey, payment completed!"
4. Your server sends confirmation emails to customer and admin
5. Customer gets their receipt, you get notified of the sale

## Setup Process

### 1. Create the Webhook Endpoint

**Location:** `src/routes/api/webhooks/stripe/+server.ts`

This creates the URL: `https://yourdomain.com/api/webhooks/stripe`

### 2. Configure in Stripe Dashboard

1. Go to [Stripe Dashboard](https://dashboard.stripe.com) → **Webhooks**
2. Click **"Add Endpoint"**
3. Set **Endpoint URL:** `https://www.angelsrest.online/api/webhooks/stripe`
   - ⚠️ **Important:** Use the EXACT URL with www if your site redirects
4. Select events to listen for:
   - `checkout.session.completed` (main one we use)
   - `payment_intent.payment_failed` (optional, for failure handling)
5. Copy the **"Signing secret"** (starts with `whsec_`)

### 3. Environment Variables

Add to your `.env` file and deployment platform (Vercel):

```bash
# Stripe 
STRIPE_SECRET_KEY=sk_live_... # or sk_test_ for testing
STRIPE_WEBHOOK_SECRET=whsec_... # The signing secret from Step 2

# Email (Resend)
RESEND_API_KEY=re_...
```

**Security Note:** Never commit these to git. Use environment variables on your deployment platform.

## Code Structure

Our webhook handler does three main jobs:

### 1. Verify the Webhook (Security)

```typescript
// Verify the webhook signature for security
event = stripe.webhooks.constructEvent(body, signature, STRIPE_WEBHOOK_SECRET);
```

**Why this matters:**
- Prevents fake webhooks from malicious actors
- Ensures the data actually came from Stripe
- Without this, anyone could send fake "payment completed" requests

### 2. Process Different Event Types

```typescript
switch (event.type) {
  case 'checkout.session.completed': 
    // Handle successful payments
  case 'payment_intent.payment_failed':
    // Handle failed payments
}
```

**We mainly care about `checkout.session.completed`** — that's when a customer successfully pays.

### 3. Send Automated Emails

When a payment completes, we send two emails:
- **Customer confirmation** — Receipt with order details and next steps
- **Admin notification** — Alert you that you have a new order to fulfill

## Email Templates

### Customer Email
- Order details and total
- Shipping address
- What happens next (processing time, shipping info)
- Professional but friendly tone
- Includes order ID for reference

### Admin Email  
- Same order details
- Direct link to Stripe Dashboard for more info
- Formatted for quick action (you can see what to fulfill immediately)

## Common Issues & Solutions

### 🚨 "HTTP Status 500" Error
**Cause:** Server error in your webhook handler
**Debug:** Check Vercel function logs for the actual error
**Common fixes:**
- Missing environment variables (`STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`)
- Typo in webhook secret
- Code errors (syntax, missing imports, etc.)

### 🚨 "307 Redirect" Error
**Cause:** Webhook URL doesn't match your final site URL
**Fix:** Update webhook URL in Stripe Dashboard to match exactly (with or without www)

### 🚨 "Webhook Signature Verification Failed"
**Causes:**
- Wrong `STRIPE_WEBHOOK_SECRET` value
- Environment variable not deployed
- Using test secret with live webhooks (or vice versa)
**Fix:** Copy the exact secret from Stripe Dashboard → Webhooks → Your endpoint → "Signing secret"

### 🚨 "This Property Cannot Be Expanded"
**Cause:** Trying to expand fields that Stripe doesn't allow
**Fix:** Only expand `line_items` and `customer_details` - not `shipping_details`

### 🚨 Emails Not Sending
**Causes:**
- Missing `RESEND_API_KEY`
- Invalid "from" email address (must be from verified domain)
- Rate limits on Resend account
**Debug:** Check Vercel logs for Resend API errors

### 🚨 Webhooks Not Reaching Dev Server
**Cause:** Stripe can't reach `localhost:5173` from the internet
**Solutions:**
- Use [ngrok](https://ngrok.com): `ngrok http 5173`, then use the ngrok URL in Stripe
- Use [Stripe CLI](https://stripe.com/docs/cli): `stripe listen --forward-to localhost:5173/api/webhooks/stripe`

## Testing

### Test Cards (Test Mode)
```
Success: 4242 4242 4242 4242
Decline: 4000 0000 0000 0002
Any future date, any CVC, any ZIP
```

### Local Testing with Stripe CLI
```bash
# Install Stripe CLI
# https://stripe.com/docs/cli

# Login to your Stripe account  
stripe login

# Forward webhooks to your local server
stripe listen --forward-to localhost:5173/api/webhooks/stripe

# Test a specific event
stripe trigger checkout.session.completed
```

### Production Testing
1. Use test mode first (test keys, test webhook endpoint)
2. Make a small test purchase ($0.01 with test card)
3. Verify emails are sent
4. Check Stripe Dashboard webhook logs show "200 OK"
5. Switch to live mode only after testing works perfectly

## Monitoring

### Stripe Dashboard
**Webhooks → [Your endpoint] → Attempts**
- See all webhook deliveries (successful and failed)
- Retry failed webhooks manually
- View request/response details for debugging

### Vercel Logs
**Dashboard → Your project → Functions → Runtime Logs**
- See actual error messages from your webhook function
- Monitor email sending success/failures
- Debug environment variable issues

### Resend Dashboard
**Logs → API calls**
- See if email API calls are succeeding
- Check bounce rates and delivery issues
- Monitor sending quotas

## Production Checklist

- [ ] **Live Stripe keys** (not test keys) in production environment
- [ ] **Live webhook secret** matching your production webhook endpoint
- [ ] **Domain verification** in Resend for your "from" email address
- [ ] **Webhook URL** points to production site (not localhost/staging)
- [ ] **Environment variables** set in deployment platform (Vercel)
- [ ] **Test purchase** with real card to verify full flow
- [ ] **Monitor first few days** for any webhook failures

## Next Steps

### Enhanced Error Handling
- Add retry logic for failed email sends
- Log important events to database for audit trail
- Set up monitoring alerts for webhook failures

### More Event Types
```typescript
case 'payment_intent.payment_failed':
  // Send "payment failed" email to customer
case 'invoice.payment_succeeded':
  // Handle subscription renewals
case 'customer.subscription.deleted':
  // Handle cancellations
```

### Customer Database Integration
- Save customer info to database on successful payment
- Track order history and customer lifetime value
- Personalize future marketing emails

### Inventory Management
- Automatically decrement stock on successful payment
- Send "out of stock" notifications
- Handle overselling scenarios

## File Structure

```
src/routes/api/webhooks/stripe/+server.ts  # Main webhook handler
├── POST()                                 # HTTP handler function
├── handleCheckoutCompleted()              # Process successful payments  
├── sendCustomerConfirmation()             # Customer receipt email
└── sendAdminNotification()                # Admin alert email
```

---

**Key takeaway:** Webhooks are essential for reliable e-commerce automation. They ensure customers always get receipts and you always get notified of sales, regardless of what happens on the client side.
