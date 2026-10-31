/// <reference types="vite/client" />
// @vitest-environment edge-runtime
import type { PaginationResult } from "convex/server";
import type { Doc } from "./_generated/dataModel";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
const modules = import.meta.glob("./**/*.ts");
test("pages through older invoices and searches them after the bounded backfill", async () => {
	const t = convexTest(schema, modules);
	const siteUrl = "audit.example";
	const email = "audit-admin@example.test";
	await t.mutation(internal.platform.seedClient, {
		name: "Audit",
		email,
		siteUrl,
		tier: "full",
		subscriptionStatus: "active",
		adminEmails: [email],
		role: "client",
	});
	const admin = t.withIdentity({ subject: email, email, emailVerified: true });
	const clientId = await admin.mutation(api.crm.createClient, {
		siteUrl,
		name: "Synthetic Client",
		email: "client@example.test",
		category: "photography",
		type: "portrait",
	});
	const oldId = await t.run(async (ctx) => {
		let first;
		for (let i = 0; i < 201; i++) {
			const id = await ctx.db.insert("invoices", {
				siteUrl,
				invoiceNumber: `INV-${String(i).padStart(3, "0")}`,
				clientId,
				clientName: "Synthetic Client",
				invoiceType: "one-time",
				status: i === 0 ? "overdue" : "paid",
				items: [{ description: "Synthetic", quantity: 1, unitPrice: 100 }],
			});
			first ??= id;
		}
		return first!;
	});
	let cursor: string | null = null;
	const ids: string[] = [];
	do {
		const result: PaginationResult<
			Doc<"invoices"> | Doc<"orders"> | Doc<"quotes"> | Doc<"contracts">
		> = await admin.query(api.businessRecords.list, {
			siteUrl,
			kind: "invoices",
			paginationOpts: { numItems: 50, cursor },
		});
		ids.push(...result.page.map((row) => row._id));
		cursor = result.isDone ? null : result.continueCursor;
	} while (cursor);
	expect(new Set(ids).size).toBe(201);
	expect(ids).toContain(oldId);
	expect(
		(await admin.query(api.businessRecords.get, { siteUrl, kind: "invoices", id: oldId }))?._id,
	).toBe(oldId);
	await expect(
		admin.query(api.businessRecords.list, {
			siteUrl,
			kind: "invoices",
			search: "INV-000",
			paginationOpts: { numItems: 50, cursor: null },
		}),
	).rejects.toThrow("search is preparing");
	let progressCursor: string | null = null;
	for (;;) {
		await t.mutation(internal.businessRecords.backfill, {
			kind: "invoices",
			cursor: progressCursor,
		});
		const progress = await t.run((ctx) =>
			ctx.db
				.query("businessSearchMigrations")
				.withIndex("by_kind", (q) => q.eq("kind", "invoices"))
				.unique(),
		);
		if (progress?.done) break;
		progressCursor = progress!.cursor;
	}
	const found = await admin.query(api.businessRecords.list, {
		siteUrl,
		kind: "invoices",
		search: "INV-000",
		status: "overdue",
		paginationOpts: { numItems: 50, cursor: null },
	});
	expect(found.page.map((row) => row._id)).toContain(oldId);
	const foreign = t.withIdentity({
		subject: "foreign",
		email: "foreign@example.test",
		emailVerified: true,
	});
	await expect(
		foreign.query(api.businessRecords.get, { siteUrl, kind: "invoices", id: oldId }),
	).rejects.toThrow();
});


test("converted invoices remain searchable by a retained client name after client deletion", async () => {
 const t = convexTest(schema, modules);
 const siteUrl = "retained.example", email = "retained-owner@example.test";
 await t.mutation(internal.platform.seedClient, {name:"Synthetic", siteUrl, email, tier:"full", subscriptionStatus:"active", adminEmails:[email], role:"client"});
 const admin = t.withIdentity({subject:email, email, emailVerified:true});
 const clientId = await admin.mutation(api.crm.createClient, {siteUrl, name:"Retained Customer", email:"customer@example.test", category:"photography", type:"portrait"});
 const quoteId = await admin.mutation(api.quotes.create, {siteUrl, clientId, packages:[{name:"Synthetic session", price:100}]});
 await admin.mutation(api.crm.deleteClient, {siteUrl, clientId});
 await t.mutation(internal.businessRecords.backfill, {kind:"invoices", cursor:null});
 const invoiceId = await admin.mutation(api.quotes.convertToInvoice, {siteUrl, quoteId, invoiceType:"one-time"});
 const invoice = await t.run(ctx=>ctx.db.get(invoiceId));
 expect(invoice?.clientName).toBe("Retained Customer");
 const found = await admin.query(api.businessRecords.list, {siteUrl,kind:"invoices",search:"Retained",paginationOpts:{numItems:50,cursor:null}});
 expect(found.page.map(row=>row._id)).toContain(invoiceId);
});
