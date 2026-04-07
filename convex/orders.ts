import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const list = query({
	args: {
		siteUrl: v.string(),
		status: v.optional(v.string()),
	},
	handler: async (ctx, { siteUrl, status }) => {
		if (status) {
			return await ctx.db
				.query("orders")
				.withIndex("by_siteUrl_status", (q) =>
					q
						.eq("siteUrl", siteUrl)
						.eq(
							"status",
							status as
								| "new"
								| "printing"
								| "ready"
								| "shipped"
								| "delivered"
								| "refunded",
						),
				)
				.order("desc")
				.collect();
		}
		return await ctx.db
			.query("orders")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.order("desc")
			.collect();
	},
});

export const create = mutation({
	args: {
		siteUrl: v.string(),
		orderNumber: v.string(),
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
		return await ctx.db.insert("orders", {
			...args,
			status: "new",
		});
	},
});

export const updateStatus = mutation({
	args: {
		orderId: v.id("orders"),
		status: v.optional(
			v.union(
				v.literal("new"),
				v.literal("printing"),
				v.literal("ready"),
				v.literal("shipped"),
				v.literal("delivered"),
				v.literal("refunded"),
			),
		),
		notes: v.optional(v.string()),
		trackingNumber: v.optional(v.string()),
		trackingUrl: v.optional(v.string()),
		lumaprintsOrderNumber: v.optional(v.string()),
		stripeFees: v.optional(v.number()),
		stripePaymentIntentId: v.optional(v.string()),
	},
	handler: async (ctx, { orderId, ...updates }) => {
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

export const getNextOrderNumber = query({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) => {
		const orders = await ctx.db
			.query("orders")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.order("desc")
			.take(1);

		const latest = orders[0];
		if (!latest) return "ORD-001";

		const num = Number.parseInt(latest.orderNumber.replace("ORD-", ""), 10);
		return `ORD-${String(num + 1).padStart(3, "0")}`;
	},
});
