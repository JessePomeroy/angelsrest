/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const WEBHOOK_SECRET = "test-webhook-secret";

beforeEach(() => {
	process.env.WEBHOOK_SECRET = WEBHOOK_SECRET;
});

afterEach(() => {
	delete process.env.WEBHOOK_SECRET;
});

async function seedClient(adminEmails: string[]) {
	const t = convexTest(schema, modules);
	await t.run(async (ctx) => {
		await ctx.db.insert("platformClients", {
			name: "Reflecting Pool",
			email: "owner@example.com",
			siteUrl: "zippymiggy.com",
			tier: "full",
			subscriptionStatus: "active",
			adminEmails,
			role: "client",
		});
	});
	return t;
}

describe("commerce notification profile lookup", () => {
	test("returns only the resolved tenant notification identity", async () => {
		const t = await seedClient(["admin@example.com", "backup@example.com"]);

		await expect(
			t.query(api.platform.getCommerceProfileForSite, {
				siteUrl: "zippymiggy.com",
				webhookSecret: WEBHOOK_SECRET,
			}),
		).resolves.toEqual({
			siteName: "Reflecting Pool",
			siteUrl: "zippymiggy.com",
			adminEmail: "admin@example.com",
		});
	});

	test("falls back to the client email when no admin recipient is configured", async () => {
		const t = await seedClient([]);

		await expect(
			t.query(api.platform.getCommerceProfileForSite, {
				siteUrl: "zippymiggy.com",
				webhookSecret: WEBHOOK_SECRET,
			}),
		).resolves.toMatchObject({ adminEmail: "owner@example.com" });
	});

	test("rejects secretless and mismatched public callers", async () => {
		const t = await seedClient(["admin@example.com"]);

		await expect(
			t.query(api.platform.getCommerceProfileForSite, {
				siteUrl: "zippymiggy.com",
			}),
		).rejects.toThrow("Not authorized");
		await expect(
			t.query(api.platform.getCommerceProfileForSite, {
				siteUrl: "zippymiggy.com",
				webhookSecret: "wrong-secret",
			}),
		).rejects.toThrow("Not authorized (webhook secret mismatch)");
	});

	test("returns null for an authenticated lookup of an unknown site", async () => {
		const t = convexTest(schema, modules);

		await expect(
			t.query(api.platform.getCommerceProfileForSite, {
				siteUrl: "unknown.example",
				webhookSecret: WEBHOOK_SECRET,
			}),
		).resolves.toBeNull();
	});
});
