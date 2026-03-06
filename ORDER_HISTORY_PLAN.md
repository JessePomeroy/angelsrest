# Order History in Sanity — Feature Plan

**Purpose:** Store orders in Sanity for custom workflow tracking, backup data, and expense tracking.

---

## Overview

When a customer completes a Stripe checkout, capture the order in Sanity with:
- Customer info (email, shipping address)
- Order items and pricing
- Payment status
- Custom fulfillment workflow status

---

## Step 1: Add Order Schema to Sanity Studio

**File:** `angelsrest-studio/schemaTypes/order.ts`

```typescript
export default {
  name: 'order',
  type: 'document',
  title: 'Order',
  fields: [
    {
      name: 'orderNumber',
      type: 'string',
      title: 'Order Number',
      description: 'Auto-generated order ID (e.g., ORD-001)'
    },
    {
      name: 'stripeSessionId',
      type: 'string',
      title: 'Stripe Session ID'
    },
    {
      name: 'customerEmail',
      type: 'string',
      title: 'Customer Email'
    },
    {
      name: 'customerName',
      type: 'string',
      title: 'Customer Name'
    },
    {
      name: 'shippingAddress',
      type: 'object',
      title: 'Shipping Address',
      fields: [
        { name: 'line1', type: 'string', title: 'Address Line 1' },
        { name: 'line2', type: 'string', title: 'Address Line 2' },
        { name: 'city', type: 'string', title: 'City' },
        { name: 'state', type: 'string', title: 'State/Province' },
        { name: 'postalCode', type: 'string', title: 'Postal Code' },
        { name: 'country', type: 'string', title: 'Country' }
      ]
    },
    {
      name: 'items',
      type: 'array',
      title: 'Order Items',
      of: [{
        type: 'object',
        fields: [
          { name: 'productName', type: 'string', title: 'Product Name' },
          { name: 'productSlug', type: 'string', title: 'Product Slug' },
          { name: 'quantity', type: 'number', title: 'Quantity' },
          { name: 'price', type: 'number', title: 'Price (cents)' },
          { name: 'image', type: 'image', title: 'Product Image', options: { hotspot: true } }
        ]
      }]
    },
    {
      name: 'subtotal',
      type: 'number',
      title: 'Subtotal (cents)'
    },
    {
      name: 'total',
      type: 'number',
      title: 'Total (cents)'
    },
    {
      name: 'currency',
      type: 'string',
      title: 'Currency',
      initialValue: 'usd'
    },
    {
      name: 'status',
      type: 'string',
      title: 'Fulfillment Status',
      options: {
        list: [
          { title: 'New', value: 'new' },
          { title: 'Printing', value: 'printing' },
          { title: 'Ready to Ship', value: 'ready' },
          { title: 'Shipped', value: 'shipped' },
          { title: 'Delivered', value: 'delivered' },
          { title: 'Refunded', value: 'refunded' }
        ]
      },
      initialValue: 'new'
    },
    {
      name: 'notes',
      type: 'text',
      title: 'Internal Notes',
      description: 'Notes for fulfillment (paper type, custom requests, etc.)'
    },
    {
      name: 'createdAt',
      type: 'datetime',
      title: 'Order Date'
    },
    {
      name: 'updatedAt',
      type: 'datetime',
      title: 'Last Updated'
    }
  ],
  preview: {
    select: {
      title: 'orderNumber',
      subtitle: 'customerEmail',
      media: 'items.0.image'
    }
  }
}
```

**Update:** `angelsrest-studio/schemaTypes/index.ts` — import and add `order` to the list.

---

## Step 2: Create Order Number Utility

Generate sequential order numbers (ORD-001, ORD-002, etc.).

**File:** `angelsrest/src/lib/orders/orderNumber.ts`

- Query Sanity for existing orders
- Find max order number
- Return next number in sequence

---

## Step 3: Update Stripe Webhook

**File:** `angelsrest/src/routes/api/webhooks/stripe/+server.ts`

Update to create order in Sanity on `checkout.session.completed`:

```typescript
// After payment verification, create order document
const orderNumber = await getNextOrderNumber();

await sanityClient.create({
  _type: 'order',
  orderNumber,
  stripeSessionId: session.id,
  customerEmail: session.customer_details?.email,
  customerName: session.customer_details?.name,
  shippingAddress: {
    line1: session.customer_details?.address?.line1,
    line2: session.customer_details?.address?.line2,
    city: session.customer_details?.address?.city,
    state: session.customer_details?.address?.state,
    postalCode: session.customer_details?.address?.postal_code,
    country: session.customer_details?.address?.country
  },
  items: session.line_items?.map(item => ({
    productName: item.price_data?.product_data?.name,
    quantity: item.quantity,
    price: item.price_data?.unit_amount
  })),
  subtotal: session.amount_subtotal,
  total: session.amount_total,
  currency: session.currency,
  status: 'new',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
});
```

**Required:** Sanity client with write token (server-side only).

---

## Step 4: Test End-to-End

1. Run dev server
2. Make a test purchase (use Stripe test mode)
3. Verify order appears in Sanity Studio
4. Check all fields populated correctly

---

## Step 5 (Optional): Admin Order List Page

Create a simple admin page to view orders without opening Sanity Studio.

**File:** `angelsrest/src/routes/admin/orders/+page.svelte`

- Fetch orders from Sanity via GROQ
- Display in table with status badges
- Filter by status
- Link to update status (future enhancement)

---

## Files to Create/Modify

| File | Action |
|------|--------|
| `angelsrest-studio/schemaTypes/order.ts` | Create |
| `angelsrest-studio/schemaTypes/index.ts` | Modify — add order import |
| `angelsrest/src/lib/orders/orderNumber.ts` | Create |
| `angelsrest/src/routes/api/webhooks/stripe/+server.ts` | Modify — add Sanity create |
| `angelsrest/src/lib/sanity/adminClient.ts` | Create (write-enabled client) |
| `angelsrest/src/routes/admin/orders/+page.svelte` | Optional |

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SANITY_WRITE_TOKEN` | Sanity token with write permissions (server-side only) |

---

## Notes

- Order numbers are sequential but not perfectly atomic — acceptable for low-volume sales
- Webhook idempotency: Check if order with `stripeSessionId` already exists before creating
- Keep write token secret — never expose to frontend
- Test with Stripe test mode (use test card 4242 4242...)

---

## Future Enhancements

- **Order lookup by email** — customers enter email to see their orders
- **Admin status updates** — change order status from frontend
- **Email notifications** — send status update emails to customers
- **Revenue dashboard** — charts of sales over time
- **Inventory sync** — auto-decrement stock when order placed
