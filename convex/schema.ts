import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { categoryValidator } from "./helpers/validators";

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
			// audit #23 PR #3: permanent fulfillment failure. The customer has
			// been auto-refunded via Stripe, the admin has been emailed, and
			// the Stripe webhook returned 200 (no retry). Admin reviews the
			// `fulfillmentError` field to understand what went wrong.
			v.literal("fulfillment_error"),
		),
		// audit #23 PR #3: set alongside status=fulfillment_error. The human-
		// readable error message from the failed LumaPrints submission.
		fulfillmentError: v.optional(v.string()),
		// audit #23 PR #3: the Stripe refund ID created automatically when the
		// order transitioned to fulfillment_error.
		stripeRefundId: v.optional(v.string()),
		notes: v.optional(v.string()),
	})
		.index("by_siteUrl", ["siteUrl"])
		.index("by_siteUrl_status", ["siteUrl", "status"])
		.index("by_stripeSessionId", ["stripeSessionId"])
		.index("by_orderNumber", ["siteUrl", "orderNumber"])
		.index("by_customerEmail", ["siteUrl", "customerEmail"])
		// Webhook lookup: LumaPrints' shipment.created webhook arrives with
		// only the LumaPrints order number (no Convex _id). Scoped by siteUrl
		// so spokes can't read each other's orders.
		.index("by_lumaprintsOrderNumber", ["siteUrl", "lumaprintsOrderNumber"]),

	// Clients (photography clients + web dev clients)
	photographyClients: defineTable({
		siteUrl: v.string(),
		name: v.string(),
		email: v.optional(v.string()),
		phone: v.optional(v.string()),
		category: categoryValidator,
		type: v.optional(
			v.union(
				// Photography types
				v.literal("wedding"),
				v.literal("portrait"),
				v.literal("family"),
				v.literal("commercial"),
				v.literal("event"),
				// Web dev types
				v.literal("website"),
				v.literal("redesign"),
				v.literal("maintenance"),
				v.literal("other"),
			),
		),
		status: v.union(
			v.literal("lead"),
			v.literal("booked"),
			v.literal("in-progress"),
			v.literal("completed"),
			v.literal("archived"),
		),
		source: v.optional(v.string()),
		notes: v.optional(v.string()),
		siteUrl_client: v.optional(v.string()),
		boardColumnId: v.optional(v.string()),
		boardPosition: v.optional(v.number()),
	})
		.index("by_siteUrl", ["siteUrl"])
		.index("by_siteUrl_status", ["siteUrl", "status"])
		.index("by_siteUrl_category", ["siteUrl", "category"])
		.index("by_siteUrl_and_boardColumnId", ["siteUrl", "boardColumnId"]),

	// Invoices — Full tier only
	invoices: defineTable({
		siteUrl: v.string(),
		invoiceNumber: v.string(),
		clientId: v.id("photographyClients"),
		clientName: v.optional(v.string()),
		invoiceType: v.union(
			v.literal("one-time"),
			v.literal("recurring"),
			v.literal("deposit"),
			v.literal("package"),
			v.literal("milestone"),
		),
		status: v.union(
			v.literal("draft"),
			v.literal("sent"),
			v.literal("paid"),
			v.literal("partial"),
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
		// Recurring config
		recurring: v.optional(
			v.object({
				interval: v.union(
					v.literal("weekly"),
					v.literal("monthly"),
					v.literal("quarterly"),
					v.literal("yearly"),
				),
				nextDueDate: v.optional(v.string()),
				endDate: v.optional(v.string()),
			}),
		),
		// Deposit/milestone tracking
		depositPercent: v.optional(v.number()),
		totalProject: v.optional(v.number()),
		paidAmount: v.optional(v.number()),
		// Milestone tracking
		milestoneName: v.optional(v.string()),
		milestoneIndex: v.optional(v.number()),
		parentInvoiceId: v.optional(v.id("invoices")),
	})
		.index("by_siteUrl", ["siteUrl"])
		.index("by_client", ["clientId"])
		.index("by_siteUrl_status", ["siteUrl", "status"]),

	// Quotes — Full tier only
	quotes: defineTable({
		siteUrl: v.string(),
		quoteNumber: v.string(),
		clientId: v.id("photographyClients"),
		clientName: v.optional(v.string()),
		category: v.optional(categoryValidator),
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
		sentAt: v.optional(v.number()),
		acceptedAt: v.optional(v.number()),
		convertedToInvoice: v.optional(v.id("invoices")),
	})
		.index("by_siteUrl", ["siteUrl"])
		.index("by_client", ["clientId"])
		.index("by_siteUrl_status", ["siteUrl", "status"]),

	// Quote presets — saved package configurations for quick loading
	quotePresets: defineTable({
		siteUrl: v.string(),
		name: v.string(),
		category: v.optional(categoryValidator),
		packages: v.array(
			v.object({
				name: v.string(),
				description: v.optional(v.string()),
				price: v.number(),
				included: v.optional(v.array(v.string())),
			}),
		),
	}).index("by_siteUrl", ["siteUrl"]),

	// Contracts — Full tier only
	contracts: defineTable({
		siteUrl: v.string(),
		title: v.string(),
		clientId: v.id("photographyClients"),
		clientName: v.optional(v.string()),
		category: v.optional(categoryValidator),
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
		sentAt: v.optional(v.number()),
		signedAt: v.optional(v.number()),
		signedByName: v.optional(v.string()),
		signedByEmail: v.optional(v.string()),
		signatureData: v.optional(v.string()),
		signedIp: v.optional(v.string()),
	})
		.index("by_siteUrl", ["siteUrl"])
		.index("by_client", ["clientId"])
		.index("by_siteUrl_status", ["siteUrl", "status"]),

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

	// Kanban board configurations — Full tier only
	boardConfigs: defineTable({
		siteUrl: v.string(),
		projectType: v.string(),
		columns: v.array(
			v.object({
				id: v.string(),
				name: v.string(),
				position: v.number(),
			}),
		),
	})
		.index("by_siteUrl", ["siteUrl"])
		.index("by_siteUrl_and_projectType", ["siteUrl", "projectType"]),

	// Email sending log
	emailLog: defineTable({
		siteUrl: v.string(),
		to: v.string(),
		subject: v.string(),
		type: v.union(
			v.literal("invoice"),
			v.literal("quote"),
			v.literal("contract"),
			v.literal("reminder"),
			v.literal("custom"),
		),
		relatedId: v.optional(v.string()),
		status: v.union(v.literal("sent"), v.literal("failed")),
		error: v.optional(v.string()),
		resendId: v.optional(v.string()),
	})
		.index("by_siteUrl", ["siteUrl"])
		.index("by_siteUrl_and_type", ["siteUrl", "type"]),

	// Portal share tokens — public links for clients to view/act on documents
	portalTokens: defineTable({
		token: v.string(),
		siteUrl: v.string(),
		type: v.union(
			v.literal("invoice"),
			v.literal("quote"),
			v.literal("contract"),
			v.literal("gallery"),
		),
		documentId: v.string(),
		clientId: v.id("photographyClients"),
		expiresAt: v.optional(v.number()),
		used: v.boolean(),
	})
		.index("by_token", ["token"])
		.index("by_siteUrl", ["siteUrl"])
		.index("by_documentId", ["documentId"]),

	// Tags for categorizing clients
	clientTags: defineTable({
		siteUrl: v.string(),
		name: v.string(),
		color: v.optional(v.string()), // hex color for display
	}).index("by_siteUrl", ["siteUrl"]),

	// Many-to-many: which tags are on which clients
	clientTagAssignments: defineTable({
		siteUrl: v.string(),
		clientId: v.id("photographyClients"),
		tagId: v.id("clientTags"),
	})
		.index("by_siteUrl", ["siteUrl"])
		.index("by_clientId", ["clientId"])
		.index("by_tagId", ["tagId"])
		// Audit M22: fast point-check for "is this tag assigned to this client?"
		// used by tags.assignTag / tags.removeTag (previously linear take(100) scans).
		.index("by_clientId_and_tagId", ["clientId", "tagId"]),

	// Activity log for tracking interactions
	activityLog: defineTable({
		siteUrl: v.string(),
		clientId: v.id("photographyClients"),
		action: v.string(),
		description: v.string(),
		metadata: v.optional(v.string()),
	})
		.index("by_siteUrl", ["siteUrl"])
		.index("by_clientId", ["clientId"]),

	// Gallery delivery — private photo galleries for client delivery
	galleries: defineTable({
		siteUrl: v.string(),
		clientId: v.id("photographyClients"),
		name: v.string(),
		slug: v.string(),
		status: v.union(
			v.literal("draft"),
			v.literal("uploading"),
			v.literal("published"),
			v.literal("archived"),
		),
		coverImageKey: v.optional(v.string()),
		imageCount: v.number(),
		totalSizeBytes: v.number(),
		password: v.optional(v.string()),
		expiresAt: v.optional(v.number()),
		downloadEnabled: v.boolean(),
		favoritesEnabled: v.boolean(),
	})
		.index("by_siteUrl", ["siteUrl"])
		.index("by_siteUrl_status", ["siteUrl", "status"])
		.index("by_siteUrl_and_slug", ["siteUrl", "slug"])
		.index("by_client", ["clientId"]),

	// Gallery images — individual photos in a delivery gallery
	galleryImages: defineTable({
		siteUrl: v.string(),
		galleryId: v.id("galleries"),
		r2Key: v.string(),
		filename: v.string(),
		sizeBytes: v.number(),
		width: v.number(),
		height: v.number(),
		order: v.number(),
		isFavorite: v.boolean(),
		downloadCount: v.number(),
	})
		.index("by_gallery", ["galleryId"])
		.index("by_siteUrl", ["siteUrl"])
		.index("by_r2Key", ["r2Key"]),

	// Gallery download tracking
	galleryDownloads: defineTable({
		siteUrl: v.string(),
		galleryId: v.id("galleries"),
		imageId: v.optional(v.id("galleryImages")),
		downloadedAt: v.number(),
		ipHash: v.string(),
		type: v.union(
			v.literal("single"),
			v.literal("zip"),
			v.literal("favorites"),
		),
	})
		// Audit M23: dropped redundant `by_gallery` — any galleryId-only query
		// also needs tenant scoping via siteUrl, so `by_siteUrl_and_galleryId`
		// covers the same lookups without the duplicate write cost.
		.index("by_siteUrl", ["siteUrl"])
		.index("by_siteUrl_and_galleryId", ["siteUrl", "galleryId"]),

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

	// Admin sidebar notification tracking
	adminLastSeen: defineTable({
		siteUrl: v.string(),
		userId: v.string(),
		page: v.string(),
		lastSeenAt: v.number(),
	})
		.index("by_siteUrl_and_userId", ["siteUrl", "userId"])
		.index("by_siteUrl_and_userId_and_page", ["siteUrl", "userId", "page"]),
});
