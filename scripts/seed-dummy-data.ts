/**
 * Seed dummy data into Convex for dashboard preview.
 *
 * Usage: npx tsx scripts/seed-dummy-data.ts
 * Remove: npx tsx scripts/seed-dummy-data.ts --remove
 */

import { ConvexHttpClient } from "convex/browser";
import dotenv from "dotenv";
import { api } from "../convex/_generated/api";

dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.local", override: true });

const convexUrl = process.env.PUBLIC_CONVEX_URL || process.env.CONVEX_URL;
if (!convexUrl) {
	console.error("Missing CONVEX_URL");
	process.exit(1);
}

const convex = new ConvexHttpClient(convexUrl);
const SITE = "angelsrest.online";

async function seed() {
	console.log("Seeding dummy data...\n");

	// --- CRM Clients ---
	const clients = [
		{
			name: "Sarah Chen",
			email: "sarah@example.com",
			category: "photography" as const,
			type: "wedding" as const,
			status: "booked" as const,
			source: "instagram",
		},
		{
			name: "Marcus Rivera",
			email: "marcus@example.com",
			category: "photography" as const,
			type: "portrait" as const,
			status: "completed" as const,
			source: "referral",
		},
		{
			name: "Emily Park",
			email: "emily@example.com",
			category: "photography" as const,
			type: "family" as const,
			status: "lead" as const,
			source: "website",
		},
		{
			name: "Jade Pottery Studio",
			email: "jade@jadepottery.com",
			category: "web" as const,
			type: "website" as const,
			status: "in-progress" as const,
			source: "word of mouth",
		},
		{
			name: "Tom & Lisa Wedding",
			email: "tom.lisa@example.com",
			category: "photography" as const,
			type: "wedding" as const,
			status: "lead" as const,
			source: "referral",
		},
		{
			name: "Blue Oak Bakery",
			email: "hello@blueoakbakery.com",
			category: "web" as const,
			type: "redesign" as const,
			status: "booked" as const,
			source: "instagram",
		},
	];

	const clientIds: string[] = [];
	for (const c of clients) {
		const { status, ...createArgs } = c;
		const id = await convex.mutation(api.crm.createClient, {
			siteUrl: SITE,
			...createArgs,
		});
		clientIds.push(id);
		if (status !== "lead") {
			await convex.mutation(api.crm.updateClient, {
				// biome-ignore lint/suspicious/noExplicitAny: seed script
				clientId: id as any,
				status,
			});
		}
		console.log(`  client: ${c.name} (${status})`);
	}

	// --- Orders ---
	const orderData = [
		{
			orderNumber: "ORD-001",
			customerEmail: "sarah@example.com",
			customerName: "Sarah Chen",
			total: 4500,
			status: "delivered" as const,
		},
		{
			orderNumber: "ORD-002",
			customerEmail: "buyer1@example.com",
			customerName: "Alex Morgan",
			total: 2800,
			status: "shipped" as const,
		},
		{
			orderNumber: "ORD-003",
			customerEmail: "buyer2@example.com",
			customerName: "Jordan Lee",
			total: 6200,
			status: "printing" as const,
		},
		{
			orderNumber: "ORD-004",
			customerEmail: "marcus@example.com",
			customerName: "Marcus Rivera",
			total: 3500,
			status: "delivered" as const,
		},
		{
			orderNumber: "ORD-005",
			customerEmail: "buyer3@example.com",
			customerName: "Priya Patel",
			total: 1500,
			status: "new" as const,
		},
		{
			orderNumber: "ORD-006",
			customerEmail: "buyer4@example.com",
			customerName: "Kai Nakamura",
			total: 8900,
			status: "delivered" as const,
		},
		{
			orderNumber: "ORD-007",
			customerEmail: "emily@example.com",
			customerName: "Emily Park",
			total: 2200,
			status: "shipped" as const,
		},
	];

	for (const o of orderData) {
		const id = await convex.mutation(api.orders.create, {
			siteUrl: SITE,
			orderNumber: o.orderNumber,
			stripeSessionId: `cs_seed_${o.orderNumber}`,
			customerEmail: o.customerEmail,
			customerName: o.customerName,
			items: [{ productName: "Fine Art Print", quantity: 1, price: o.total }],
			total: o.total,
			fulfillmentType: "self",
		});
		if (o.status !== "new") {
			await convex.mutation(api.orders.updateStatus, {
				orderId: id,
				status: o.status,
				stripeFees: Math.round(o.total * 0.029 + 30),
			});
		}
		console.log(`  order: ${o.orderNumber} — $${(o.total / 100).toFixed(2)}`);
	}

	// --- Invoices ---
	const invoiceData = [
		{
			number: "INV-001",
			clientIdx: 0,
			type: "deposit" as const,
			status: "paid",
			total: 125000,
		},
		{
			number: "INV-002",
			clientIdx: 3,
			type: "milestone" as const,
			status: "sent",
			total: 150000,
		},
		{
			number: "INV-003",
			clientIdx: 5,
			type: "one-time" as const,
			status: "draft",
			total: 300000,
		},
		{
			number: "INV-004",
			clientIdx: 1,
			type: "one-time" as const,
			status: "paid",
			total: 35000,
		},
		{
			number: "INV-005",
			clientIdx: 4,
			type: "deposit" as const,
			status: "sent",
			total: 100000,
		},
	];

	for (const inv of invoiceData) {
		const id = await convex.mutation(api.invoices.create, {
			siteUrl: SITE,
			invoiceNumber: inv.number,
			// biome-ignore lint/suspicious/noExplicitAny: seed script
			clientId: clientIds[inv.clientIdx] as any,
			invoiceType: inv.type,
			items: [{ description: "Service", quantity: 1, unitPrice: inv.total }],
			dueDate: "2026-05-01",
		});
		if (inv.status === "sent") {
			await convex.mutation(api.invoices.markSent, { invoiceId: id });
		} else if (inv.status === "paid") {
			await convex.mutation(api.invoices.markSent, { invoiceId: id });
			await convex.mutation(api.invoices.markPaid, { invoiceId: id });
		}
		console.log(
			`  invoice: ${inv.number} — $${(inv.total / 100).toFixed(2)} (${inv.status})`,
		);
	}

	// --- Quotes ---
	const quoteData = [
		{
			number: "QT-001",
			clientIdx: 2,
			status: "sent",
			category: "photography" as const,
		},
		{
			number: "QT-002",
			clientIdx: 4,
			status: "accepted",
			category: "photography" as const,
		},
		{
			number: "QT-003",
			clientIdx: 3,
			status: "draft",
			category: "web" as const,
		},
	];

	for (const q of quoteData) {
		const id = await convex.mutation(api.quotes.create, {
			siteUrl: SITE,
			quoteNumber: q.number,
			// biome-ignore lint/suspicious/noExplicitAny: seed script
			clientId: clientIds[q.clientIdx] as any,
			category: q.category,
			packages: [
				{
					name: "basic",
					description: "Standard package",
					price: 150000,
					included: ["2 hours", "50 edited photos", "online gallery"],
				},
				{
					name: "premium",
					description: "Full coverage",
					price: 250000,
					included: [
						"4 hours",
						"150 edited photos",
						"online gallery",
						"prints",
					],
				},
			],
			validUntil: "2026-05-15",
		});
		if (q.status === "sent") {
			await convex.mutation(api.quotes.markSent, { quoteId: id });
		} else if (q.status === "accepted") {
			await convex.mutation(api.quotes.markSent, { quoteId: id });
			await convex.mutation(api.quotes.markAccepted, { quoteId: id });
		}
		console.log(`  quote: ${q.number} (${q.status})`);
	}

	console.log("\nDone. Seeded 6 clients, 7 orders, 5 invoices, 3 quotes.");
}

async function remove() {
	console.log("Removing dummy data...\n");

	// Remove orders with seed session IDs
	const orders = await convex.query(api.orders.list, { siteUrl: SITE });
	for (const order of orders) {
		if (order.stripeSessionId.startsWith("cs_seed_")) {
			await convex.mutation(api.orders.updateStatus, {
				orderId: order._id,
				status: "refunded",
			});
			console.log(`  removed order: ${order.orderNumber}`);
		}
	}

	// Remove all CRM clients (and their invoices/quotes cascade)
	const clients = await convex.query(api.crm.listClients, { siteUrl: SITE });
	for (const client of clients) {
		await convex.mutation(api.crm.deleteClient, { clientId: client._id });
		console.log(`  removed client: ${client.name}`);
	}

	// Remove invoices
	const invoices = await convex.query(api.invoices.list, { siteUrl: SITE });
	for (const inv of invoices) {
		await convex.mutation(api.invoices.remove, { invoiceId: inv._id });
		console.log(`  removed invoice: ${inv.invoiceNumber}`);
	}

	// Remove quotes
	const quotes = await convex.query(api.quotes.list, { siteUrl: SITE });
	for (const q of quotes) {
		await convex.mutation(api.quotes.remove, { quoteId: q._id });
		console.log(`  removed quote: ${q.quoteNumber}`);
	}

	console.log("\nDone. Removed all dummy data.");
}

const isRemove = process.argv.includes("--remove");
(isRemove ? remove() : seed()).catch((err) => {
	console.error("Failed:", err);
	process.exit(1);
});
