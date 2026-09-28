/// <reference types="vite/client" />
// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
const modules = import.meta.glob("./**/*.ts");

test("retains accepted/converted quotes and signed contracts despite later status changes", async () => {
	const t = convexTest(schema, modules);
	await t.mutation(internal.platform.seedClient, {
		name: "A",
		email: "admin@example.com",
		siteUrl: "a.example",
		tier: "full",
		adminEmails: ["admin@example.com"],
	});
	const admin = t.withIdentity({
		subject: "admin",
		email: "admin@example.com",
		emailVerified: true,
	});
	const clientId = await admin.mutation(api.crm.createClient, {
		siteUrl: "a.example",
		name: "Client",
		email: "client@example.com",
		category: "photography",
		type: "portrait",
	});
	const quote = () =>
		admin.mutation(api.quotes.create, {
			siteUrl: "a.example",
			clientId,
			packages: [{ name: "Session", price: 100 }],
		});
	const contract = () =>
		admin.mutation(api.contracts.create, {
			siteUrl: "a.example",
			clientId,
			title: "Agreement",
			body: "Terms",
		});
	const quoteId = await quote();
	await admin.mutation(api.quotes.markAccepted, { siteUrl: "a.example", quoteId });
	await admin.mutation(api.quotes.update, { siteUrl: "a.example", quoteId, status: "draft" });
	await expect(
		admin.mutation(api.quotes.remove, { siteUrl: "a.example", quoteId }),
	).rejects.toThrow("must be retained");
	const contractId = await contract();
	await admin.mutation(api.contracts.markSigned, { siteUrl: "a.example", contractId });
	await admin.mutation(api.contracts.update, {
		siteUrl: "a.example",
		contractId,
		status: "expired",
	});
	await expect(
		admin.mutation(api.contracts.remove, { siteUrl: "a.example", contractId }),
	).rejects.toThrow("must be retained");
	const legacy = await contract();
	await t.run((ctx) => ctx.db.patch(legacy, { signatureData: "legacy-signature" }));
	await expect(
		admin.mutation(api.contracts.remove, { siteUrl: "a.example", contractId: legacy }),
	).rejects.toThrow("must be retained");
	const converted = await quote();
	const invoice = await t.run((ctx) =>
		ctx.db.insert("invoices", {
			siteUrl: "a.example",
			clientId,
			invoiceNumber: "I-1",
			status: "draft",
			invoiceType: "one-time",
			items: [],
		}),
	);
	await t.run((ctx) => ctx.db.patch(converted, { convertedToInvoice: invoice }));
	await expect(
		admin.mutation(api.quotes.remove, { siteUrl: "a.example", quoteId: converted }),
	).rejects.toThrow("must be retained");
	await expect(
		admin.mutation(api.invoices.remove, { siteUrl: "a.example", invoiceId: invoice }),
	).rejects.toThrow("must be retained");
	const disposableQuote = await quote();
	const disposableContract = await contract();
	await expect(
		t
			.withIdentity({ subject: "intruder" })
			.mutation(api.quotes.remove, { siteUrl: "a.example", quoteId: disposableQuote }),
	).rejects.toThrow();
	await admin.mutation(api.quotes.remove, { siteUrl: "a.example", quoteId: disposableQuote });
	await admin.mutation(api.contracts.remove, {
		siteUrl: "a.example",
		contractId: disposableContract,
	});
	expect(await t.run((ctx) => ctx.db.get(disposableQuote))).toBeNull();
	expect(await t.run((ctx) => ctx.db.get(disposableContract))).toBeNull();
});
