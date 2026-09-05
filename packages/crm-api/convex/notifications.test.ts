/// <reference types="vite/client" />
// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
const modules = import.meta.glob("./**/*.ts");
const siteUrl = "notifications.example";
afterEach(() => vi.useRealTimers());
async function setup() {
	vi.useFakeTimers();
	vi.setSystemTime(1000);
	const t = convexTest(schema, modules);
	await t.mutation(internal.platform.seedClient, {
		name: "Admin",
		email: "admin@example.test",
		siteUrl,
		tier: "full",
		subscriptionStatus: "active",
		adminEmails: ["admin@example.test"],
		role: "client",
	});
	const admin = t.withIdentity({
		subject: "admin",
		email: "admin@example.test",
		emailVerified: true,
	});
	const clientId = await t.run((ctx) =>
		ctx.db.insert("photographyClients", {
			siteUrl,
			name: "Client",
			category: "photography",
			status: "booked",
		}),
	);
	return { t, admin, clientId };
}
const transitions = ["accepted", "declined", "paid", "overdue", "signed"] as const;
type Transition = (typeof transitions)[number];
function pageFor(status: Transition) {
	return status === "signed"
		? "contracts"
		: status === "accepted" || status === "declined"
			? "quotes"
			: "invoices";
}
async function insertTransition(
	ctx: MutationCtx,
	clientId: Id<"photographyClients">,
	status: Transition,
	time?: number,
	site = siteUrl,
) {
	if (status === "accepted" || status === "declined")
		return ctx.db.insert("quotes", {
			siteUrl: site,
			clientId,
			quoteNumber: "Q",
			packages: [],
			status,
			...(time === undefined
				? {}
				: status === "accepted"
					? { acceptedAt: time }
					: { declinedAt: time }),
		});
	if (status === "signed")
		return ctx.db.insert("contracts", {
			siteUrl: site,
			clientId,
			title: "C",
			body: "Terms",
			status,
			...(time === undefined ? {} : { signedAt: time }),
		});
	return ctx.db.insert("invoices", {
		siteUrl: site,
		clientId,
		invoiceNumber: "I",
		invoiceType: "one-time",
		items: [],
		status,
		...(time === undefined ? {} : status === "paid" ? { paidAt: time } : { overdueAt: time }),
	});
}
test.each(
	transitions,
)("finds an older %s transition behind ten newer drafts and respects last seen", async (status) => {
	const { t, admin, clientId } = await setup();
	await t.run((ctx) => insertTransition(ctx, clientId, status, 3000));
	vi.setSystemTime(2000);
	await admin.mutation(api.notifications.markSeen, { siteUrl, page: pageFor(status) });
	await t.run(async (ctx) => {
		for (let i = 0; i < 10; i++) {
			await ctx.db.insert("quotes", {
				siteUrl,
				clientId,
				quoteNumber: `Q${i}`,
				packages: [],
				status: "draft",
			});
			await ctx.db.insert("invoices", {
				siteUrl,
				clientId,
				invoiceNumber: `I${i}`,
				invoiceType: "one-time",
				items: [],
				status: "draft",
			});
			await ctx.db.insert("contracts", {
				siteUrl,
				clientId,
				title: `C${i}`,
				body: "Terms",
				status: "draft",
			});
		}
	});
	expect((await admin.query(api.notifications.getUnreadFlags, { siteUrl }))[pageFor(status)]).toBe(
		true,
	);
	vi.setSystemTime(3000);
	await admin.mutation(api.notifications.markSeen, { siteUrl, page: pageFor(status) });
	expect((await admin.query(api.notifications.getUnreadFlags, { siteUrl }))[pageFor(status)]).toBe(
		false,
	);
});
test.each(
	transitions,
)("preserves legacy %s creation fallback alongside older timestamped records", async (status) => {
	const { t, admin, clientId } = await setup();
	await t.run((ctx) => insertTransition(ctx, clientId, status, 1000));
	vi.setSystemTime(2000);
	await admin.mutation(api.notifications.markSeen, { siteUrl, page: pageFor(status) });
	vi.setSystemTime(3000);
	await t.run((ctx) => insertTransition(ctx, clientId, status));
	expect((await admin.query(api.notifications.getUnreadFlags, { siteUrl }))[pageFor(status)]).toBe(
		true,
	);
	vi.setSystemTime(4000);
	await admin.mutation(api.notifications.markSeen, { siteUrl, page: pageFor(status) });
	expect((await admin.query(api.notifications.getUnreadFlags, { siteUrl }))[pageFor(status)]).toBe(
		false,
	);
});
test("admin updates record real transitions without resetting timestamps on repeated status or note edits", async () => {
	const { t, admin, clientId } = await setup();
	const [quoteId, invoiceId, contractId] = await t.run(
		async (ctx) =>
			[
				await ctx.db.insert("quotes", {
					siteUrl,
					clientId,
					quoteNumber: "Q",
					packages: [],
					status: "draft",
				}),
				await ctx.db.insert("invoices", {
					siteUrl,
					clientId,
					invoiceNumber: "I",
					invoiceType: "one-time",
					items: [],
					status: "draft",
				}),
				await ctx.db.insert("contracts", {
					siteUrl,
					clientId,
					title: "C",
					body: "Terms",
					status: "draft",
				}),
			] as const,
	);
	vi.setSystemTime(2000);
	await admin.mutation(api.quotes.update, { siteUrl, quoteId, status: "accepted" });
	await admin.mutation(api.invoices.update, { siteUrl, invoiceId, status: "paid" });
	await admin.mutation(api.contracts.update, { siteUrl, contractId, status: "signed" });
	vi.setSystemTime(3000);
	await admin.mutation(api.quotes.update, { siteUrl, quoteId, status: "accepted", notes: "Edit" });
	await admin.mutation(api.invoices.update, { siteUrl, invoiceId, notes: "Edit" });
	await admin.mutation(api.contracts.update, {
		siteUrl,
		contractId,
		status: "signed",
		title: "Edit",
	});
	expect(await t.run((ctx) => ctx.db.get(quoteId))).toMatchObject({ acceptedAt: 2000 });
	expect(await t.run((ctx) => ctx.db.get(invoiceId))).toMatchObject({ paidAt: 2000 });
	expect(await t.run((ctx) => ctx.db.get(contractId))).toMatchObject({ signedAt: 2000 });
	await admin.mutation(api.quotes.update, { siteUrl, quoteId, status: "declined" });
	await admin.mutation(api.invoices.update, { siteUrl, invoiceId, status: "overdue" });
	expect(await t.run((ctx) => ctx.db.get(quoteId))).toMatchObject({ declinedAt: 3000 });
	expect(await t.run((ctx) => ctx.db.get(invoiceId))).toMatchObject({ overdueAt: 3000 });
	vi.setSystemTime(4000);
	await admin.mutation(api.quotes.markDeclined, { siteUrl, quoteId });
	expect(await t.run((ctx) => ctx.db.get(quoteId))).toMatchObject({ declinedAt: 4000 });
});
test("does not leak foreign transitions and requires stored site membership", async () => {
	const { t, admin, clientId } = await setup();
	for (const status of transitions)
		await t.run((ctx) => insertTransition(ctx, clientId, status, 5000, "other.example"));
	expect(await admin.query(api.notifications.getUnreadFlags, { siteUrl })).toMatchObject({
		quotes: false,
		invoices: false,
		contracts: false,
	});
	await expect(t.query(api.notifications.getUnreadFlags, { siteUrl })).rejects.toThrow(
		"Not authenticated",
	);
	await expect(
		admin.query(api.notifications.getUnreadFlags, { siteUrl: "other.example" }),
	).rejects.toThrow();
	await expect(
		admin.mutation(api.notifications.markSeen, { siteUrl: "other.example", page: "quotes" }),
	).rejects.toThrow();
});

test("portal decline records its transition once across token retries", async () => {
	const { t, admin, clientId } = await setup();
	const quoteId = await t.run((ctx) =>
		ctx.db.insert("quotes", { siteUrl, clientId, quoteNumber: "Q", packages: [], status: "sent" }),
	);
	const token = await admin.mutation(api.portal.createToken, {
		siteUrl,
		type: "quote",
		documentId: quoteId,
		clientId,
	});
	vi.setSystemTime(2000);
	await t.mutation(api.portal.declineQuote, { token });
	vi.setSystemTime(3000);
	await t.mutation(api.portal.declineQuote, { token });
	expect(await t.run((ctx) => ctx.db.get(quoteId))).toMatchObject({
		status: "declined",
		declinedAt: 2000,
	});
});
