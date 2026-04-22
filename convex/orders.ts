import { v } from "convex/values";
import { internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { requireAuth, requireWebhookCallerOrAuth } from "./authHelpers";
import { getNextSequentialNumber } from "./helpers/numbering";

const orderStatusValidator = v.union(
	v.literal("new"),
	v.literal("printing"),
	v.literal("ready"),
	v.literal("shipped"),
	v.literal("delivered"),
	v.literal("refunded"),
	v.literal("fulfillment_error"),
);

export const list = query({
	args: {
		siteUrl: v.string(),
		status: v.optional(orderStatusValidator),
	},
	handler: async (ctx, { siteUrl, status }) => {
		await requireAuth(ctx);
		if (status) {
			return await ctx.db
				.query("orders")
				.withIndex("by_siteUrl_status", (q) =>
					q.eq("siteUrl", siteUrl).eq("status", status),
				)
				.order("desc")
				.take(500);
		}
		return await ctx.db
			.query("orders")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.order("desc")
			.take(500);
	},
});

/**
 * Create a new order. Called by the Stripe webhook (with `webhookSecret`) or
 * by admin tooling (with an authenticated session). Audit C4: the old
 * version accepted any caller; now requires either the shared webhook
 * secret or an authenticated admin.
 */
export const create = mutation({
	args: {
		siteUrl: v.string(),
		webhookSecret: v.optional(v.string()),
		orderNumber: v.optional(v.string()),
		stripeSessionId: v.string(),
		customerEmail: v.string(),
		customerName: v.optional(v.string()),
		stripePaymentIntentId: v.optional(v.string()),
		shippingAddress: v.optional(
			v.object({
				line1: v.string(),
				line2: v.optional(v.string()),
				city: v.string(),
				state: v.string(),
				postalCode: v.string(),
				country: v.string(),
			}),
		),
		items: v.array(
			v.object({
				productName: v.string(),
				quantity: v.number(),
				price: v.number(),
			}),
		),
		total: v.number(),
		subtotal: v.optional(v.number()),
		stripeFees: v.optional(v.number()),
		fulfillmentType: v.union(
			v.literal("lumaprints"),
			v.literal("self"),
			v.literal("digital"),
		),
		paperName: v.optional(v.string()),
		paperSubcategoryId: v.optional(v.string()),
		couponCode: v.optional(v.string()),
		discountAmount: v.optional(v.number()),
	},
	handler: async (ctx, args) => {
		await requireWebhookCallerOrAuth(ctx, args.webhookSecret);
		// Don't let the secret leak into the stored document.
		const { webhookSecret: _discard, ...rest } = args;
		// Idempotency: if an order with this stripeSessionId already exists,
		// return it along with fulfillment state so the caller can skip
		// already-completed side effects (LumaPrints submission, fee capture,
		// confirmation emails). Previously only `_id` and `orderNumber` were
		// returned, which caused retries to re-submit to LumaPrints and
		// re-email the customer. See audit C13.
		const existing = await ctx.db
			.query("orders")
			.withIndex("by_stripeSessionId", (q) =>
				q.eq("stripeSessionId", args.stripeSessionId),
			)
			.unique();
		if (existing) {
			return {
				_id: existing._id,
				orderNumber: existing.orderNumber,
				alreadyExisted: true as const,
				lumaprintsOrderNumber: existing.lumaprintsOrderNumber,
				status: existing.status,
				stripeFees: existing.stripeFees,
			};
		}

		// Use provided order number or generate one atomically
		const orderNumber =
			args.orderNumber ||
			(await getNextSequentialNumber(
				ctx,
				"orders",
				args.siteUrl,
				"orderNumber",
				"ORD-",
			));

		const _id = await ctx.db.insert("orders", {
			...rest,
			orderNumber,
			status: "new",
		});

		// Schedule Stripe fee capture off the webhook hot path (audit H5).
		// Stripe's balance_transaction isn't populated the instant
		// checkout.session.completed fires, so we wait 15s then fetch.
		// The action is idempotent and reschedules itself up to 3 times if
		// the fee still isn't available — see convex/stripeFees.ts.
		if (rest.stripePaymentIntentId) {
			await ctx.scheduler.runAfter(
				15_000,
				internal.stripeFees.captureFeesForOrder,
				{ orderId: _id },
			);
		}

		return {
			_id,
			orderNumber,
			alreadyExisted: false as const,
			lumaprintsOrderNumber: undefined,
			status: "new" as const,
			stripeFees: undefined,
		};
	},
});

/**
 * Update an order. Called by the webhook (fee capture, LumaPrints number,
 * refund fields — with `webhookSecret`) and by the admin UI (tracking /
 * status overrides — with an authenticated session).
 *
 * Audit C4: the old version accepted any caller; now requires either the
 * shared webhook secret or an authenticated admin.
 */
export const updateStatus = mutation({
	args: {
		orderId: v.id("orders"),
		webhookSecret: v.optional(v.string()),
		status: v.optional(orderStatusValidator),
		notes: v.optional(v.string()),
		trackingNumber: v.optional(v.string()),
		trackingUrl: v.optional(v.string()),
		lumaprintsOrderNumber: v.optional(v.string()),
		stripeFees: v.optional(v.number()),
		stripePaymentIntentId: v.optional(v.string()),
		fulfillmentError: v.optional(v.string()),
		stripeRefundId: v.optional(v.string()),
	},
	handler: async (ctx, { orderId, webhookSecret, ...updates }) => {
		await requireWebhookCallerOrAuth(ctx, webhookSecret);
		const patch: Record<string, unknown> = {};
		for (const [key, val] of Object.entries(updates)) {
			if (val !== undefined) patch[key] = val;
		}
		if (Object.keys(patch).length > 0) {
			await ctx.db.patch(orderId, patch);
		}
	},
});

export const lookup = query({
	args: {
		siteUrl: v.string(),
		email: v.string(),
		orderNumber: v.string(),
	},
	handler: async (ctx, { siteUrl, email, orderNumber }) => {
		const order = await ctx.db
			.query("orders")
			.withIndex("by_orderNumber", (q) =>
				q.eq("siteUrl", siteUrl).eq("orderNumber", orderNumber),
			)
			.first();

		if (!order || order.customerEmail.toLowerCase() !== email.toLowerCase()) {
			return null;
		}

		return {
			orderNumber: order.orderNumber,
			status: order.status,
			items: order.items,
			total: order.total,
			trackingNumber: order.trackingNumber,
			trackingUrl: order.trackingUrl,
		};
	},
});

export const getStats = query({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) => {
		await requireAuth(ctx);
		const orders = await ctx.db
			.query("orders")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.order("desc")
			.take(5000);

		const now = new Date();
		const todayStart = new Date(
			now.getFullYear(),
			now.getMonth(),
			now.getDate(),
		);
		const weekStart = new Date(todayStart);
		weekStart.setDate(todayStart.getDate() - todayStart.getDay());
		const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

		let todayRevenue = 0;
		let weekRevenue = 0;
		let monthRevenue = 0;
		let allTimeRevenue = 0;

		// Build daily revenue map for last 30 days
		const dailyRevenueMap = new Map<string, number>();
		for (let i = 29; i >= 0; i--) {
			const d = new Date(todayStart);
			d.setDate(d.getDate() - i);
			dailyRevenueMap.set(d.toISOString().split("T")[0], 0);
		}

		for (const order of orders) {
			const total = order.total || 0;
			allTimeRevenue += total;

			const orderDate = new Date(order._creationTime);
			if (orderDate >= todayStart) todayRevenue += total;
			if (orderDate >= weekStart) weekRevenue += total;
			if (orderDate >= monthStart) monthRevenue += total;

			const dateKey = orderDate.toISOString().split("T")[0];
			if (dailyRevenueMap.has(dateKey)) {
				dailyRevenueMap.set(
					dateKey,
					(dailyRevenueMap.get(dateKey) || 0) + total,
				);
			}
		}

		const dailyRevenue = Array.from(dailyRevenueMap.entries()).map(
			([date, amount]) => ({ date, amount }),
		);

		const recentOrders = orders.slice(0, 10).map((order) => ({
			_id: order._id,
			orderNumber: order.orderNumber,
			createdAt: new Date(order._creationTime).toISOString(),
			customerEmail: order.customerEmail,
			customerName: order.customerName || "",
			total: order.total,
			stripeFees: order.stripeFees || 0,
			status: order.status,
		}));

		return {
			stats: {
				todayRevenue,
				weekRevenue,
				monthRevenue,
				allTimeRevenue,
				totalOrders: orders.length,
			},
			dailyRevenue,
			recentOrders,
		};
	},
});

export const getNextOrderNumber = query({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) => {
		await requireAuth(ctx);
		return getNextSequentialNumber(
			ctx,
			"orders",
			siteUrl,
			"orderNumber",
			"ORD-",
		);
	},
});
