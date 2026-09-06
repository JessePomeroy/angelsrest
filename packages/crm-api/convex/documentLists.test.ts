/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
afterEach(() => vi.useRealTimers());

test.each(["invoices", "quotes", "contracts"] as const)(
	"%s lists filter before the cap and retain ordering and tenant authorization",
	async (table) => {
		vi.useFakeTimers({ toFake: ["Date"] });
		const t = convexTest(schema, modules);
		const siteUrl = "documents.example";
		await t.mutation(internal.platform.seedClient, {
			name: "Documents", email: "admin@example.com", siteUrl,
			tier: "full", subscriptionStatus: "active", role: "client",
			adminEmails: ["admin@example.com"],
		});
		const admin = t.withIdentity({ subject: "admin", email: "admin@example.com", emailVerified: true });
		await t.run(async (ctx) => {
			const clientId = await ctx.db.insert("photographyClients", {
				siteUrl, name: "Client", category: "photography", status: "lead",
			});
			for (let index = 0; index < 202; index++) {
				vi.setSystemTime(1_800_000_000_000 + index);
				const common = { siteUrl, clientId, status: index === 0 ? "draft" as const : "sent" as const,
					...(index > 0 ? { clientName: `new-${index}` } : {}),
				};
				if (table === "invoices") await ctx.db.insert(table, {
					...common, invoiceNumber: `I-${index}`, invoiceType: "one-time", items: [],
				});
				else if (table === "quotes") await ctx.db.insert(table, {
					...common, quoteNumber: `Q-${index}`, packages: [],
				});
				else await ctx.db.insert(table, { ...common, title: `C-${index}`, body: "Contract" });
			}
		});
		const filtered = await admin.query(api[table].list, { siteUrl, status: "draft" });
		expect(filtered).toHaveLength(1);
		expect(filtered[0]).toMatchObject({ status: "draft", clientName: "unknown" });
		const all = await admin.query(api[table].list, { siteUrl });
		expect(all).toHaveLength(200);
		expect(all[0].clientName).toBe("new-201");
		expect(all.at(-1)?.clientName).toBe("new-2");
		await expect(admin.query(api[table].list, { siteUrl, status: "unknown-status" })).resolves.toEqual([]);
		await expect(admin.query(api[table].list, { siteUrl: "other.example", status: "unknown-status" })).rejects.toThrow(/Not authorized/);
	},
);
