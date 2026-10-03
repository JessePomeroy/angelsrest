/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import type { PaginationResult } from "convex/server";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const WEBHOOK_SECRET = "test-webhook-secret";

beforeEach(() => {
	process.env.WEBHOOK_SECRET = WEBHOOK_SECRET;
});

afterEach(() => {
	delete process.env.WEBHOOK_SECRET;
});

describe("inquiry creation boundary", () => {
	test("accepts and strips the shared server webhook secret", async () => {
		const t = convexTest(schema, modules);

		const inquiryId = await t.mutation(api.inquiries.create, {
			webhookSecret: WEBHOOK_SECRET,
			siteUrl: "tenant.example",
			name: "Example Person",
			email: "person@example.com",
			message: "Hello",
		});

		const inquiry = await t.run(async (ctx) => await ctx.db.get(inquiryId));
		expect(inquiry).toMatchObject({ name: "Example Person", status: "new" });
		expect(inquiry).not.toHaveProperty("webhookSecret");
	});

	test("rejects direct callers that omit the shared secret", async () => {
		const t = convexTest(schema, modules);
		const argsWithoutSecret = {
			siteUrl: "tenant.example",
			name: "Direct Caller",
			email: "direct@example.com",
			message: "Bypass attempt",
		};

		await expect(
			t.mutation(api.inquiries.create, argsWithoutSecret as never),
		).rejects.toThrow("Missing required field `webhookSecret`");
	});

	test("rejects direct callers with the wrong secret", async () => {
		const t = convexTest(schema, modules);

		await expect(
			t.mutation(api.inquiries.create, {
				webhookSecret: "wrong-secret",
				siteUrl: "tenant.example",
				name: "Example Person",
				email: "person@example.com",
				message: "Hello",
			}),
		).rejects.toThrow("Not authorized (webhook secret mismatch)");
	});
});

describe("inquiry pagination", () => {
	const siteUrl = "inquiries.example.test";
	const email = "admin@inquiries.example.test";
	const firstPage = { numItems: 50, cursor: null };

	async function setup() {
		const t = convexTest(schema, modules);
		const siteId = await t.run((ctx) => ctx.db.insert("platformClients", {
			name: "Synthetic inbox",
			email,
			siteUrl,
			tier: "full",
			subscriptionStatus: "active",
			adminEmails: [email],
			role: "client",
		}));
		await t.run((ctx) => ctx.db.insert("platformClients", {
			name: "Other tenant", email: "other@example.test", siteUrl: "foreign.example.test",
			tier: "full", subscriptionStatus: "active", adminEmails: ["other@example.test"], role: "client",
		}));
		return {
			t,
			siteId,
			admin: t.withIdentity({ subject: "inquiry-admin", email, emailVerified: true }),
		};
	}

	test("reaches the oldest unanswered inquiry beyond 200 rows and filters before paging", async () => {
		const { t, admin } = await setup();
		const oldest = await t.run(async (ctx) => {
			const id = await ctx.db.insert("inquiries", {
				siteUrl, name: "Oldest unanswered", email, message: "Synthetic", status: "new",
			});
			for (let i = 0; i < 205; i++) {
				await ctx.db.insert("inquiries", {
					siteUrl, name: `Replied ${i}`, email, message: "Synthetic", status: "replied",
				});
			}
			await ctx.db.insert("inquiries", {
				siteUrl: "foreign.example.test", name: "Other tenant", email,
				message: "Synthetic", status: "new",
			});
			return id;
		});
		const expected = await admin.query(api.inquiries.list, { siteUrl, limit: 500 });
		const capped = await admin.query(api.inquiries.listPaginated, {
			siteUrl, paginationOpts: { numItems: 500, maximumRowsRead: 500, cursor: null },
		});
		expect(capped.page.length).toBeLessThanOrEqual(50);
		const seen: Id<"inquiries">[] = [];
		let cursor: string | null = null;
		let isDone = false;
		for (let i = 0; i < 10 && !isDone; i++) {
			const result: PaginationResult<Doc<"inquiries">> = await admin.query(
				api.inquiries.listPaginated,
				{ siteUrl, paginationOpts: { numItems: 25, cursor } },
			);
			expect(result.page.length).toBeLessThanOrEqual(25);
			expect(result.pageStatus).not.toBe("SplitRequired");
			expect(result.page.every((row) => row.siteUrl === siteUrl)).toBe(true);
			seen.push(...result.page.map((row) => row._id));
			cursor = result.continueCursor;
			isDone = result.isDone;
		}
		expect(isDone).toBe(true);
		expect(seen).toEqual(expected.map((row) => row._id));
		expect(seen).toHaveLength(206);
		expect(new Set(seen).size).toBe(seen.length);
		expect(seen.at(-1)).toBe(oldest);
		const unread = await admin.query(api.inquiries.listPaginated, {
			siteUrl, status: "new", paginationOpts: firstPage,
		});
		expect(unread.page.map((row) => row._id)).toEqual([oldest]);
		expect(unread.isDone).toBe(true);
		expect(await admin.query(api.inquiries.countNew, { siteUrl })).toBe(1);
	});

	test("bounds a widened reactive cursor range and preserves its split metadata", async () => {
		const { t, admin } = await setup();
		const endCursor = await t.run(async (ctx) => {
			for (let i = 0; i < 80; i++) {
				await ctx.db.insert("inquiries", {
					siteUrl, name: `Range ${i}`, email, message: "Synthetic", status: "new",
				});
			}
			return (await ctx.db.query("inquiries")
				.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
				.order("desc").paginate({ numItems: 80, cursor: null })).continueCursor;
		});
		const result = await admin.query(api.inquiries.listPaginated, {
			siteUrl, paginationOpts: { numItems: 1, cursor: null, endCursor, maximumRowsRead: 500 },
		});
		expect(result.page.length).toBeLessThanOrEqual(50);
		expect(result.isDone).toBe(false);
		expect(result.pageStatus).toBe("SplitRequired");
		expect(result.splitCursor).toBeTruthy();
	});

	test("status changes and deletion update filtered results and the unread count", async () => {
		const { t, admin } = await setup();
		const id = await t.run((ctx) => ctx.db.insert("inquiries", {
			siteUrl, name: "Status transition", email, message: "Synthetic", status: "new",
		}));
		await admin.mutation(api.inquiries.updateStatus, { id, status: "read" });
		const unread = await admin.query(api.inquiries.listPaginated, {
			siteUrl, status: "new", paginationOpts: firstPage,
		});
		expect(unread.page).toEqual([]);
		expect(await admin.query(api.inquiries.countNew, { siteUrl })).toBe(0);
		const read = await admin.query(api.inquiries.listPaginated, {
			siteUrl, status: "read", paginationOpts: firstPage,
		});
		expect(read.page.map((row) => row._id)).toEqual([id]);
		await admin.mutation(api.inquiries.remove, { id });
		expect((await admin.query(api.inquiries.listPaginated, {
			siteUrl, paginationOpts: firstPage,
		})).page).toEqual([]);
	});

	test("authorizes every page against current stored membership", async () => {
		const { t, admin, siteId } = await setup();
		const args = { siteUrl, paginationOpts: firstPage };
		await expect(t.query(api.inquiries.listPaginated, args)).rejects.toThrow("Not authenticated");
		await expect(admin.query(api.inquiries.listPaginated, {
			...args, siteUrl: "foreign.example.test",
		})).rejects.toThrow("Not authorized");
		await t.run(async (ctx) => {
			for (let i = 0; i < 2; i++) {
				await ctx.db.insert("inquiries", {
					siteUrl, name: `Member ${i}`, email, message: "Synthetic", status: "new",
				});
			}
		});
		const first = await admin.query(api.inquiries.listPaginated, {
			siteUrl, paginationOpts: { numItems: 1, cursor: null },
		});
		await t.run((ctx) => ctx.db.patch(siteId, { adminEmails: [] }));
		await expect(admin.query(api.inquiries.listPaginated, {
			siteUrl, paginationOpts: { numItems: 1, cursor: first.continueCursor },
		})).rejects.toThrow("Not authorized");
	});
});
