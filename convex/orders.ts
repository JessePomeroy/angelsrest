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
				.take(500);
		}
		return await ctx.db
			.query("orders")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.order("desc")
			.take(500);
	},
});

export const create = mutation({
	args: {
		siteUrl: v.string(),
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
		// Use provided order number or generate one atomically
		let orderNumber = args.orderNumber;
		if (!orderNumber) {
			const latest = await ctx.db
				.query("orders")
				.withIndex("by_siteUrl", (q) => q.eq("siteUrl", args.siteUrl))
				.order("desc")
				.take(1);

			orderNumber = "ORD-001";
			if (latest[0]) {
				const num = Number.parseInt(
					latest[0].orderNumber.replace("ORD-", ""),
					10,
				);
				orderNumber = `ORD-${String(num + 1).padStart(3, "0")}`;
			}
		}

		const _id = await ctx.db.insert("orders", {
			...args,
			orderNumber,
			status: "new",
		});

		return { _id, orderNumber };
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

export const getStats = query({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) => {
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
