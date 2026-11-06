/// <reference types="vite/client" />
// @vitest-environment edge-runtime
import type { FunctionReturnType } from "convex/server";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const readers = {
	invoices: api.clientWorkspace.listInvoices,
	quotes: api.clientWorkspace.listQuotes,
	contracts: api.clientWorkspace.listContracts,
	galleries: api.clientWorkspace.listDeliveryGalleries,
};
type Collection = keyof typeof readers;
const collections = Object.keys(readers) as Collection[];
const owner = {
	subject: "owner-a",
	email: "owner-a@example.test",
	emailVerified: true,
	tokenIdentifier: "https://identity.example.test|owner-a",
};
const siteUrl = "workspace-a.example.test";
const otherSiteUrl = "workspace-b.example.test";

async function setup() {
	const t = convexTest(schema, modules);
	const tenant = await t.mutation(internal.platform.seedClient, {
		siteUrl,
		name: "Fictional Workspace A",
		email: owner.email,
		adminEmails: [owner.email],
		tier: "full",
		subscriptionStatus: "active",
		role: "client",
	});
	await t.run((ctx) => ctx.db.patch(tenant.id, { adminIdentityIds: [owner.tokenIdentifier] }));
	const otherOwner = { subject: "owner-b", email: "owner-b@example.test", emailVerified: true };
	await t.mutation(internal.platform.seedClient, {
		siteUrl: otherSiteUrl,
		name: "Fictional Workspace B",
		email: otherOwner.email,
		adminEmails: [otherOwner.email],
		tier: "full",
		subscriptionStatus: "active",
		role: "client",
	});
	const clients = await t.run(async (ctx) => ({
		selected: await ctx.db.insert("photographyClients", {
			siteUrl,
			name: "Morgan Reed",
			email: "shared@example.test",
			category: "photography",
			status: "booked",
		}),
		other: await ctx.db.insert("photographyClients", {
			siteUrl,
			name: "Unrelated client with the same email",
			email: "shared@example.test",
			category: "photography",
			status: "lead",
		}),
		foreign: await ctx.db.insert("photographyClients", {
			siteUrl: otherSiteUrl,
			name: "Foreign client",
			email: "shared@example.test",
			category: "photography",
			status: "booked",
		}),
	}));
	async function addRecords(kind: Collection, clientId: Id<"photographyClients">, count = 1) {
		return await t.run(async (ctx) => {
			const ids: string[] = [];
			for (let index = 0; index < count; index++) {
				const scope = { clientId, siteUrl: clientId === clients.foreign ? otherSiteUrl : siteUrl };
				switch (kind) {
					case "invoices":
						ids.push(
							await ctx.db.insert("invoices", {
								...scope,
								invoiceNumber: `INV-${index}`,
								invoiceType: "one-time",
								status: "partial",
								items: [{ description: "private line description", quantity: 1, unitPrice: 300 }],
								paidAmount: 100,
								notes: "private invoice note",
								stripeCheckoutSessionId: "private-provider-id",
							}),
						);
						break;
					case "quotes":
						ids.push(
							await ctx.db.insert("quotes", {
								...scope,
								quoteNumber: `QUO-${index}`,
								status: "sent",
								packages: [
									{ name: "private package", description: "private description", price: 300 },
								],
								notes: "private quote note",
							}),
						);
						break;
					case "contracts":
						ids.push(
							await ctx.db.insert("contracts", {
								...scope,
								title: `Session agreement ${index}`,
								status: "signed",
								body: "private contract body",
								signatureData: "private signature",
								signedIp: "192.0.2.1",
								signedByEmail: "private@example.test",
								signedAt: 1_700_000_000_000,
							}),
						);
						break;
					case "galleries":
						ids.push(
							await ctx.db.insert("galleries", {
								...scope,
								name: `Portrait delivery ${index}`,
								slug: `private-slug-${index}`,
								status: "draft",
								imageCount: 2,
								totalSizeBytes: 200,
								downloadEnabled: false,
								favoritesEnabled: false,
								coverImageKey: "private/storage/key",
							}),
						);
						break;
				}
			}
			return ids;
		});
	}
	return {
		t,
		admin: t.withIdentity(owner),
		foreign: t.withIdentity(otherOwner),
		tenantId: tenant.id,
		clients,
		addRecords,
	};
}

test.each(
	collections,
)("%s pages all linked records beyond the old cap and excludes email matches", async (kind) => {
	const { t, admin, clients, addRecords } = await setup();
	const expected = await addRecords(kind, clients.selected, 61);
	await addRecords(kind, clients.other, 5);
	await addRecords(kind, clients.foreign, 3);
	const found: string[] = [];
	let cursor: string | null = null;
	for (let pageNumber = 0; pageNumber < 4; pageNumber++) {
		const result: FunctionReturnType<(typeof readers)[Collection]> = await admin.query(
			readers[kind],
			{
				clientId: clients.selected,
				paginationOpts: { cursor, numItems: 25 },
			},
		);
		expect(result).toMatchObject({ siteUrl, clientId: clients.selected });
		expect(result.page.length).toBeLessThanOrEqual(25);
		found.push(...result.page.map((row) => row._id));
		if (result.isDone) break;
		expect(result.continueCursor).not.toBe(cursor);
		cursor = result.continueCursor;
	}
	expect(found).toHaveLength(61);
	expect(new Set(found)).toEqual(new Set(expected));
	const blankClient = await t.run((ctx) =>
		ctx.db.insert("photographyClients", {
			siteUrl,
			name: "Empty client",
			category: "photography",
			status: "lead",
		}),
	);
	expect(
		await admin.query(readers[kind], {
			clientId: blankClient,
			paginationOpts: { cursor: null, numItems: 25 },
		}),
	).toMatchObject({ page: [], isDone: true });
});

test.each(
	collections,
)("%s denies anonymous, foreign, unclaimed, downgraded and revoked access", async (kind) => {
	const { t, admin, foreign, clients, tenantId, addRecords } = await setup();
	await addRecords(kind, clients.selected, 3);
	const args = { clientId: clients.selected, paginationOpts: { cursor: null, numItems: 1 } };
	await expect(t.query(readers[kind], args)).rejects.toThrow("Not authenticated");
	await expect(foreign.query(readers[kind], args)).rejects.toThrow("Not authorized");
	await expect(admin.query(readers[kind], { ...args, clientId: clients.foreign })).rejects.toThrow(
		"Not authorized",
	);
	const unclaimed = t.withIdentity({
		...owner,
		tokenIdentifier: "https://identity.example.test|unclaimed",
	});
	await expect(unclaimed.query(readers[kind], args)).rejects.toThrow("Not authorized");
	const first = await admin.query(readers[kind], args);
	const next = { ...args, paginationOpts: { numItems: 1, cursor: first.continueCursor } };
	await t.run((ctx) => ctx.db.patch(tenantId, { tier: "basic" }));
	await expect(admin.query(readers[kind], next)).rejects.toThrow("plan");
	await t.run((ctx) =>
		ctx.db.patch(tenantId, { tier: "full", adminIdentityIds: ["replacement-owner"] }),
	);
	await expect(admin.query(readers[kind], next)).rejects.toThrow("Not authorized");
});

test.each(
	collections,
)("%s rejects malformed cross-site associations and omits private fields", async (kind) => {
	const { t, admin, clients, addRecords } = await setup();
	await addRecords(kind, clients.selected);
	const args = { clientId: clients.selected, paginationOpts: { cursor: null, numItems: 25 } };
	const result = await admin.query(readers[kind], args);
	const fields = {
		invoices: [
			"_id",
			"_creationTime",
			"invoiceNumber",
			"invoiceType",
			"status",
			"dueDate",
			"balance",
		],
		quotes: ["_id", "_creationTime", "quoteNumber", "status", "validUntil"],
		contracts: ["_id", "_creationTime", "title", "status", "eventDate", "signedAt"],
		galleries: [
			"_id",
			"_creationTime",
			"name",
			"status",
			"imageCount",
			"expiresAt",
			"proofSubmittedAt",
		],
	};
	expect(Object.keys(result.page[0]).sort()).toEqual(fields[kind].sort());
	expect(JSON.stringify(result)).not.toContain("private");
	await t.run((ctx) => ctx.db.patch(result.page[0]._id, { siteUrl: otherSiteUrl }));
	await expect(admin.query(readers[kind], args)).rejects.toThrow("ownership does not match");
});

test("all collections reject invalid page sizes and cannot disclose another client's rows through a cursor", async () => {
	const { admin, clients, addRecords } = await setup();
	for (const kind of collections) {
		await addRecords(kind, clients.selected, 3);
		await addRecords(kind, clients.other, 3);
		for (const numItems of [0, -1, 1.5, 51, Number.NaN, Number.POSITIVE_INFINITY]) {
			await expect(
				admin.query(readers[kind], {
					clientId: clients.selected,
					paginationOpts: { cursor: null, numItems },
				}),
			).rejects.toThrow();
		}
		const first = await admin.query(readers[kind], {
			clientId: clients.selected,
			paginationOpts: { cursor: null, numItems: 1 },
		});
		// Convex may reject a cursor from another query; if accepted, it must still stay client-scoped.
		const mismatched = await admin
			.query(readers[kind], {
				clientId: clients.other,
				paginationOpts: { cursor: first.continueCursor, numItems: 1 },
			})
			.catch(() => null);
		if (mismatched) {
			expect(mismatched.clientId).toBe(clients.other);
			expect(mismatched.page.some((row) => row._id === first.page[0]._id)).toBe(false);
		}
	}
});

test("caller read limits cannot widen a fixed-range page beyond the server row budget", async () => {
	const { admin, clients, addRecords } = await setup();
	await addRecords("contracts", clients.selected, 120);
	const first = await admin.query(readers.contracts, {
		clientId: clients.selected,
		paginationOpts: { cursor: null, numItems: 50 },
	});
	const second = await admin.query(readers.contracts, {
		clientId: clients.selected,
		paginationOpts: { cursor: first.continueCursor, numItems: 50 },
	});
	const ranged = await admin.query(readers.contracts, {
		clientId: clients.selected,
		paginationOpts: {
			cursor: null,
			numItems: 1,
			endCursor: second.continueCursor,
			maximumRowsRead: 10_000,
			maximumBytesRead: 10_000_000,
		},
	});
	expect(ranged.page).toHaveLength(50);
	expect(ranged).toMatchObject({ isDone: false, pageStatus: "SplitRequired" });
	expect(ranged.splitCursor).toBeTruthy();
	expect(ranged.continueCursor).toBe(first.continueCursor);
});

test("large private bodies yield a byte-limited split page rather than a complete or expanded result", async () => {
	const { t, admin, clients } = await setup();
	await t.run(async (ctx) => {
		for (let index = 0; index < 20; index++) {
			await ctx.db.insert("contracts", {
				siteUrl,
				clientId: clients.selected,
				title: `Large agreement ${index}`,
				status: "draft",
				body: "private body ".repeat(10_000),
			});
		}
	});
	const page = await admin.query(readers.contracts, {
		clientId: clients.selected,
		paginationOpts: { cursor: null, numItems: 25, maximumBytesRead: 10_000_000 },
	});
	expect(page.page.length).toBeGreaterThan(0);
	expect(page.page.length).toBeLessThan(20);
	expect(page).toMatchObject({ isDone: false, pageStatus: "SplitRequired" });
	expect(page.splitCursor).toBeTruthy();
	expect(page.continueCursor).toBeTruthy();
	expect(JSON.stringify(page)).not.toContain("private body");
	expect(JSON.stringify(page).length).toBeLessThan(10_000);
});

test("invoice summaries reuse settled, fractional and unknown historical balance semantics", async () => {
	const { t, admin, clients } = await setup();
	await t.run(async (ctx) => {
		const base = {
			siteUrl,
			clientId: clients.selected,
			invoiceType: "one-time" as const,
			items: [{ description: "Private", quantity: 1, unitPrice: 300 }],
		};
		await ctx.db.insert("invoices", { ...base, invoiceNumber: "LEGACY-PAID", status: "paid" });
		await ctx.db.insert("invoices", {
			...base,
			invoiceNumber: "UNKNOWN-PARTIAL",
			status: "partial",
		});
		await ctx.db.insert("invoices", {
			...base,
			invoiceNumber: "INVALID",
			status: "sent",
			items: [{ description: "Private", quantity: -1, unitPrice: 300 }],
		});
		await ctx.db.insert("invoices", {
			...base,
			invoiceNumber: "OVERPAID",
			status: "paid",
			paidAmount: 400,
		});
		await ctx.db.insert("invoices", {
			...base,
			invoiceNumber: "FRACTIONAL",
			status: "sent",
			items: [{ description: "Private", quantity: 1.5, unitPrice: 50 }],
			taxPercent: 7.5,
		});
	});
	const page = await admin.query(readers.invoices, {
		clientId: clients.selected,
		paginationOpts: { cursor: null, numItems: 25 },
	});
	const balances = Object.fromEntries(page.page.map((row) => [row.invoiceNumber, row.balance]));
	expect(balances).toEqual({
		"LEGACY-PAID": { totalCents: 300, paidCents: 300, remainingCents: 0, overpaidCents: 0 },
		"UNKNOWN-PARTIAL": null,
		INVALID: null,
		OVERPAID: { totalCents: 300, paidCents: 400, remainingCents: 0, overpaidCents: 100 },
		FRACTIONAL: { totalCents: 81, paidCents: 0, remainingCents: 81, overpaidCents: 0 },
	});
});
