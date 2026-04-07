/**
 * One-time migration: Sanity orders → Convex
 *
 * Usage:
 *   npx tsx scripts/migrate-orders-to-convex.ts
 *
 * Requires:
 *   CONVEX_URL in .env.local (already set by convex dev)
 *   SANITY_WRITE_TOKEN in .env
 *   PUBLIC_SANITY_PROJECT_ID in .env
 */

import { createClient } from "@sanity/client";
import { ConvexHttpClient } from "convex/browser";
import dotenv from "dotenv";
import { api } from "../convex/_generated/api";

dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.local", override: true });

const SITE_URL = "angelsrest.online";

const sanity = createClient({
	projectId: process.env.PUBLIC_SANITY_PROJECT_ID,
	dataset: "production",
	apiVersion: "2024-01-01",
	useCdn: false,
	token: process.env.SANITY_WRITE_TOKEN,
});

const convexUrl = process.env.PUBLIC_CONVEX_URL || process.env.CONVEX_URL;

if (!convexUrl) {
	console.error("Missing CONVEX_URL or PUBLIC_CONVEX_URL in environment");
	process.exit(1);
}

const convex = new ConvexHttpClient(convexUrl);

async function migrate() {
	console.log("Fetching orders from Sanity...");

	const orders = await sanity.fetch(
		`*[_type == "order"] | order(createdAt asc) {
			_id,
			orderNumber,
			stripeSessionId,
			stripePaymentIntentId,
			customerEmail,
			customerName,
			shippingAddress,
			items,
			subtotal,
			total,
			stripeFees,
			fulfillmentType,
			lumaprintsOrderNumber,
			paperName,
			paperSubcategoryId,
			trackingNumber,
			trackingUrl,
			status,
			notes,
			createdAt
		}`,
	);

	console.log(`Found ${orders.length} orders to migrate.`);

	let migrated = 0;
	let skipped = 0;

	for (const order of orders) {
		// Skip orders without required fields
		if (!order.orderNumber || !order.stripeSessionId) {
			console.log(`  Skipping order (missing data): ${order._id}`);
			skipped++;
			continue;
		}

		// Check if already migrated
		const existing = await convex.query(api.orders.lookup, {
			siteUrl: SITE_URL,
			email: order.customerEmail || "",
			orderNumber: order.orderNumber,
		});

		if (existing) {
			console.log(`  Already exists: ${order.orderNumber}`);
			skipped++;
			continue;
		}

		// Map items to Convex format
		const items = (order.items || []).map((item: any) => ({
			productName: item.productName || item.title || "Print",
			quantity: item.quantity || 1,
			price: item.price || 0,
		}));

		// Map shipping address
		const shippingAddress = order.shippingAddress
			? {
					line1: order.shippingAddress.line1 || "",
					line2: order.shippingAddress.line2 || undefined,
					city: order.shippingAddress.city || "",
					state: order.shippingAddress.state || "",
					postalCode: order.shippingAddress.postalCode || "",
					country: order.shippingAddress.country || "",
				}
			: undefined;

		// Create in Convex
		const id = await convex.mutation(api.orders.create, {
			siteUrl: SITE_URL,
			orderNumber: order.orderNumber,
			stripeSessionId: order.stripeSessionId,
			customerEmail: order.customerEmail || "",
			customerName: order.customerName || undefined,
			stripePaymentIntentId: order.stripePaymentIntentId || undefined,
			shippingAddress,
			items,
			total: order.total || 0,
			subtotal: order.subtotal || undefined,
			stripeFees: order.stripeFees || undefined,
			fulfillmentType: order.fulfillmentType || "self",
			paperName: order.paperName || undefined,
			paperSubcategoryId: order.paperSubcategoryId || undefined,
			couponCode: undefined,
			discountAmount: undefined,
		});

		// Update with additional fields that aren't in create
		if (
			order.status !== "new" ||
			order.notes ||
			order.trackingNumber ||
			order.lumaprintsOrderNumber
		) {
			await convex.mutation(api.orders.updateStatus, {
				orderId: id,
				status: order.status || "new",
				notes: order.notes || undefined,
				trackingNumber: order.trackingNumber || undefined,
				trackingUrl: order.trackingUrl || undefined,
				lumaprintsOrderNumber: order.lumaprintsOrderNumber || undefined,
				stripeFees: order.stripeFees || undefined,
				stripePaymentIntentId: order.stripePaymentIntentId || undefined,
			});
		}

		console.log(`  Migrated: ${order.orderNumber}`);
		migrated++;
	}

	console.log(
		`\nDone. Migrated ${migrated}, skipped ${skipped} of ${orders.length} total.`,
	);
}

migrate().catch((err) => {
	console.error("Migration failed:", err);
	process.exit(1);
});
