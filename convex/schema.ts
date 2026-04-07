import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
	// Photographers you've built sites for
	platformClients: defineTable({
		name: v.string(),
		email: v.string(),
		siteUrl: v.string(),
		sanityProjectId: v.optional(v.string()),
		tier: v.union(v.literal("basic"), v.literal("full")),
		subscriptionStatus: v.union(
			v.literal("active"),
			v.literal("canceled"),
			v.literal("past_due"),
			v.literal("none"),
		),
		stripeCustomerId: v.optional(v.string()),
		stripeSubscriptionId: v.optional(v.string()),
		adminEmails: v.array(v.string()),
		notes: v.optional(v.string()),
	})
		.index("by_siteUrl", ["siteUrl"])
		.index("by_email", ["email"])
		.index("by_stripeSubscriptionId", ["stripeSubscriptionId"]),

	// Print orders (from Stripe checkout on any client site)
	orders: defineTable({
		siteUrl: v.string(),
		orderNumber: v.string(),
		stripeSessionId: v.string(),
		stripePaymentIntentId: v.optional(v.string()),
		customerEmail: v.string(),
		customerName: v.optional(v.string()),
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
		subtotal: v.optional(v.number()),
		total: v.number(),
		stripeFees: v.optional(v.number()),
		couponCode: v.optional(v.string()),
		discountAmount: v.optional(v.number()),
		fulfillmentType: v.union(
			v.literal("lumaprints"),
			v.literal("self"),
			v.literal("digital"),
		),
		lumaprintsOrderNumber: v.optional(v.string()),
		paperName: v.optional(v.string()),
		paperSubcategoryId: v.optional(v.string()),
		trackingNumber: v.optional(v.string()),
		trackingUrl: v.optional(v.string()),
		status: v.union(
			v.literal("new"),
			v.literal("printing"),
			v.literal("ready"),
			v.literal("shipped"),
			v.literal("delivered"),
			v.literal("refunded"),
		),
		notes: v.optional(v.string()),
	})
		.index("by_siteUrl", ["siteUrl"])
		.index("by_siteUrl_status", ["siteUrl", "status"])
		.index("by_stripeSessionId", ["stripeSessionId"])
		.index("by_orderNumber", ["siteUrl", "orderNumber"])
		.index("by_customerEmail", ["siteUrl", "customerEmail"]),

	// Photographer's clients (the people they photograph) — Full tier only
	photographyClients: defineTable({
		siteUrl: v.string(),
		name: v.string(),
		email: v.optional(v.string()),
		phone: v.optional(v.string()),
		type: v.optional(
			v.union(
				v.literal("wedding"),
				v.literal("portrait"),
				v.literal("family"),
				v.literal("commercial"),
				v.literal("event"),
				v.literal("other"),
			),
		),
		status: v.union(
			v.literal("lead"),
			v.literal("booked"),
			v.literal("completed"),
			v.literal("archived"),
		),
		source: v.optional(v.string()),
		notes: v.optional(v.string()),
	})
		.index("by_siteUrl", ["siteUrl"])
		.index("by_siteUrl_status", ["siteUrl", "status"]),

	// Invoices — Full tier only
	invoices: defineTable({
		siteUrl: v.string(),
		invoiceNumber: v.string(),
		clientId: v.id("photographyClients"),
		status: v.union(
			v.literal("draft"),
			v.literal("sent"),
			v.literal("paid"),
			v.literal("overdue"),
			v.literal("canceled"),
		),
		items: v.array(
			v.object({
				description: v.string(),
				quantity: v.number(),
				unitPrice: v.number(),
			}),
		),
		taxPercent: v.optional(v.number()),
		notes: v.optional(v.string()),
		dueDate: v.optional(v.string()),
		sentAt: v.optional(v.number()),
		paidAt: v.optional(v.number()),
	})
		.index("by_siteUrl", ["siteUrl"])
		.index("by_client", ["clientId"])
		.index("by_siteUrl_status", ["siteUrl", "status"]),

	// Quotes — Full tier only
	quotes: defineTable({
		siteUrl: v.string(),
		quoteNumber: v.string(),
		clientId: v.id("photographyClients"),
		status: v.union(
			v.literal("draft"),
			v.literal("sent"),
			v.literal("accepted"),
			v.literal("declined"),
			v.literal("expired"),
		),
		packages: v.array(
			v.object({
				name: v.string(),
				description: v.optional(v.string()),
				price: v.number(),
				included: v.optional(v.array(v.string())),
			}),
		),
		validUntil: v.optional(v.string()),
		notes: v.optional(v.string()),
	})
		.index("by_siteUrl", ["siteUrl"])
		.index("by_client", ["clientId"]),

	// Contracts — Full tier only
	contracts: defineTable({
		siteUrl: v.string(),
		title: v.string(),
		clientId: v.id("photographyClients"),
		templateId: v.optional(v.id("contractTemplates")),
		status: v.union(
			v.literal("draft"),
			v.literal("sent"),
			v.literal("signed"),
			v.literal("expired"),
		),
		body: v.string(),
		eventDate: v.optional(v.string()),
		eventLocation: v.optional(v.string()),
		totalPrice: v.optional(v.number()),
		depositAmount: v.optional(v.number()),
		signedAt: v.optional(v.number()),
	})
		.index("by_siteUrl", ["siteUrl"])
		.index("by_client", ["clientId"]),

	// Contract templates — Full tier only
	contractTemplates: defineTable({
		siteUrl: v.string(),
		name: v.string(),
		body: v.string(),
		variables: v.optional(v.array(v.string())),
	}).index("by_siteUrl", ["siteUrl"]),

	// Email templates — Full tier only
	emailTemplates: defineTable({
		siteUrl: v.string(),
		name: v.string(),
		category: v.union(
			v.literal("inquiry-reply"),
			v.literal("booking-confirmation"),
			v.literal("reminder"),
			v.literal("gallery-delivery"),
			v.literal("follow-up"),
			v.literal("thank-you"),
			v.literal("custom"),
		),
		subject: v.string(),
		body: v.string(),
		variables: v.optional(v.array(v.string())),
	})
		.index("by_siteUrl", ["siteUrl"])
		.index("by_siteUrl_category", ["siteUrl", "category"]),

	// Platform messages (client <-> creator communication)
	platformMessages: defineTable({
		siteUrl: v.string(),
		sender: v.union(v.literal("client"), v.literal("creator")),
		content: v.string(),
		read: v.boolean(),
	})
		.index("by_siteUrl", ["siteUrl"])
		.index("by_siteUrl_unread", ["siteUrl", "read"]),

	// Contact form inquiries (from public site visitors)
	inquiries: defineTable({
		siteUrl: v.string(),
		name: v.string(),
		email: v.string(),
		phone: v.optional(v.string()),
		subject: v.optional(v.string()),
		message: v.string(),
		status: v.union(v.literal("new"), v.literal("read"), v.literal("replied")),
	})
		.index("by_siteUrl", ["siteUrl"])
		.index("by_siteUrl_status", ["siteUrl", "status"]),
});
