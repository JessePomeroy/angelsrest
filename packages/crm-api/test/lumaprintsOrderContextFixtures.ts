/// <reference types="vite/client" />
import type { FunctionArgs } from "convex/server";
import { convexTest } from "convex-test";
import { api, internal } from "../convex/_generated/api";
import type { Doc } from "../convex/_generated/dataModel";
import { reservationHandleHash, reservationSnapshotDigest } from "../convex/helpers/checkoutSnapshot";
import type { LumaPrintsConnection } from "../convex/helpers/lumaprintsConnection";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");
export const secret = "test-supplier-context-secret";
export const claimToken = "123e4567-e89b-42d3-a456-426614174000";
const handle = "123e4567-e89b-42d3-a456-426614174099";
const snapshot: Doc<"checkoutSnapshotReservations">["snapshot"] = { schemaVersion: 1 as const, catalogProvider: "convex" as const,
	items: [{ productKey: "print", revisionId: "revision", productKind: "print" as const, variantKey: "glossy", materialOptionKey: "glossy", sizeOptionKey: "4x6", borderOptionKey: null, frameOptionKey: null }] };
const printInput: NonNullable<Doc<"orders">["printInput"]> = {
	version: 1, lines: [{ amountCents: 1000, sources: [{
		descriptor: { key: "sites/client1.example/catalog/source/original", hash: "a".repeat(64), bytes: 1000,
			mime: "image/jpeg", dimensions: { width: 1200, height: 1800 } },
		item: { paperSubcategoryId: 103007, width: 4, height: 6 },
		product: { subcategoryId: 103007, orderItemOptions: [39] },
	}] }],
};

export async function setup() {
	const t = convexTest(schema, modules);
	async function tenant(index: number) {
		const tenantId = `tenant_11111111-1111-4111-8111-${String(index).padStart(12, "0")}`;
		const siteUrl = `client${index}.example`;
		const connection: LumaPrintsConnection = {
			version: 1, connectionRef: `lp_client_${index}_original`, tenantId, storeId: 101, environment: "sandbox",
		};
		const clientId = await t.run(async ctx => {
			const clientId = await ctx.db.insert("platformClients", { tenantId, siteUrl, name: `Client ${index}`,
				email: `owner@${siteUrl}`, adminEmails: [`owner@${siteUrl}`], tier: "full", role: "client", subscriptionStatus: "active",
				lumaprintsConnectionRef: connection.connectionRef });
			await ctx.db.insert("lumaprintsConnections", { ...connection, clientId, storeVerifiedAt: Date.now(),
				accountOwnershipConfirmedAt: Date.now(), billingConfirmedAt: Date.now() });
			await ctx.db.insert("commercePurposeControls", { siteUrl, purpose: "new_provider_submission", state: "open",
				generation: 1, createdAt: Date.now(), updatedAt: Date.now() });
			return clientId;
		});
		const args = { tenantId, siteUrl, webhookSecret: secret, stripeSessionId: `cs_test_supplier${String(index).padStart(16, "0")}`,
			customerEmail: `buyer@${siteUrl}`, items: [{ productName: "Print", quantity: 1, price: 1000 }], total: 1000,
			fulfillmentType: "lumaprints" as const, shippingRecipientName: "Test Buyer",
			shippingAddress: { line1: "1 Test Street", city: "Detroit", state: "MI", postalCode: "48201", country: "US" },
			checkoutSnapshotReservation: { version: 2, handle }, runPrintJob: true } satisfies FunctionArgs<typeof api.orders.create>;
		const hash = await reservationHandleHash(siteUrl, handle);
		const digest = await reservationSnapshotDigest(snapshot);
		const reservationId = await t.run(ctx => ctx.db.insert("checkoutSnapshotReservations", {
			state: "bound", tenantId, siteUrl, handleHash: hash, snapshotDigest: digest, snapshot, printInput: { ...printInput, lines: printInput.lines.map(line => ({ ...line,
				sources: line.sources.map(source => ({ ...source, descriptor: { ...source.descriptor, key: `sites/${siteUrl}/catalog/source/original` } })),
			})) },
			lumaprintsConnection: connection, accountScope: "platform", stripeSessionId: args.stripeSessionId,
			stripeExpiresAt: Date.now() / 1000 + 3600, unboundPurgeAt: Date.now() + 3600000,
			createdAt: Date.now(), updatedAt: Date.now(),
		}));
		return { connection, clientId, reservationId, args };
	}
	async function paid(index: number) {
		const seed = await tenant(index);
		const order = await t.mutation(api.orders.create, seed.args);
		if (!order.printJobId) throw new Error("Expected print job");
		const jobId = order.printJobId;
		await t.run(ctx => ctx.db.patch(jobId, { stage: "finish", nextAt: Date.now() }));
		const lease = await t.mutation(internal.printFulfillmentJobs.begin, { jobId, nextAt: Date.now() });
		if (!lease) throw new Error("Expected job lease");
		const command = { orderId: order._id, tenantId: seed.connection.tenantId, claimToken,
			printJobLeaseToken: lease.leaseToken, webhookSecret: secret };
		return { ...seed, order, command, jobId, lease };
	}
	async function submitted(index: number, orderNumber = "12345") {
		const seed = await paid(index);
		await t.mutation(api.orders.claimPrintFulfillmentV5, { ...seed.command, lumaprintsConnection: seed.connection });
		await t.mutation(api.orders.beginPrintFulfillmentSubmission, seed.command);
		await t.mutation(api.orders.recordPrintFulfillmentSubmissionReceipt, {
			orderId: seed.order._id, claimToken, externalId: seed.args.stripeSessionId,
			lumaprintsSubmissionOrderNumber: orderNumber, tenantId: seed.connection.tenantId, webhookSecret: secret,
		});
		return seed;
	}
	return { t, tenant, paid, submitted };
}
