/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
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

async function setupPlatformAdmin() {
	const t = convexTest(schema, modules);
	const email = "creator@example.com";
	await t.run(async (ctx) => {
		await ctx.db.insert("platformClients", {
			name: "Angel's Rest",
			email,
			siteUrl: "angelsrest.online",
			tier: "full",
			subscriptionStatus: "active",
			adminEmails: [email],
			role: "creator",
		});
	});
	return { t, admin: t.withIdentity({ subject: email, email }) };
}

function clientInput(siteUrl: string, name = siteUrl) {
	return {
		name,
		email: `owner@${siteUrl}`,
		siteUrl,
		tier: "full" as const,
		subscriptionStatus: "active" as const,
		adminEmails: [`owner@${siteUrl}`],
		role: "client" as const,
	};
}

describe("platform tenant site identity", () => {
	test("rejects duplicate create and colliding update without changing either row", async () => {
		const { t, admin } = await setupPlatformAdmin();
		const firstId = await admin.mutation(
			api.platform.createClient,
			clientInput("first.example"),
		);
		await expect(
			admin.mutation(api.platform.createClient, clientInput("first.example", "Duplicate")),
		).rejects.toThrow(/already owns siteUrl/i);

		const secondId = await admin.mutation(
			api.platform.createClient,
			clientInput("second.example"),
		);
		await expect(
			admin.mutation(api.platform.updateClient, {
				clientId: secondId,
				siteUrl: "first.example",
			}),
		).rejects.toThrow(/already owns siteUrl/i);

		const stored = await t.run(async (ctx) => ({
			first: await ctx.db.get(firstId),
			second: await ctx.db.get(secondId),
		}));
		expect(stored.first?.siteUrl).toBe("first.example");
		expect(stored.second?.siteUrl).toBe("second.example");
	});

	test("allows only one of two concurrent creates for the same site identity", async () => {
		const { t, admin } = await setupPlatformAdmin();
		const attempts = await Promise.allSettled([
			admin.mutation(api.platform.createClient, clientInput("concurrent.example", "A")),
			admin.mutation(api.platform.createClient, clientInput("concurrent.example", "B")),
		]);
		expect(attempts.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
		expect(attempts.filter(({ status }) => status === "rejected")).toHaveLength(1);
		const rows = await t.run(async (ctx) =>
			await ctx.db
				.query("platformClients")
				.withIndex("by_siteUrl", (q) => q.eq("siteUrl", "concurrent.example"))
				.collect(),
		);
		expect(rows).toHaveLength(1);
	});
});

describe("platform catalog product capability policy", () => {
	test("stores canonical policies through creator-only create and update paths", async () => {
		const { t, admin } = await setupPlatformAdmin();
		const clientId = await admin.mutation(api.platform.createClient, {
			...clientInput("catalog.example"),
			catalogProductKinds: ["postcard", "print"],
		});
		await expect(t.run(async (ctx) => await ctx.db.get(clientId))).resolves
			.toMatchObject({ catalogProductKinds: ["print", "postcard"] });

		await admin.mutation(api.platform.updateClient, {
			clientId,
			catalogProductKinds: ["merchandise", "print_set"],
		});
		await expect(t.run(async (ctx) => await ctx.db.get(clientId))).resolves
			.toMatchObject({ catalogProductKinds: ["print_set", "merchandise"] });

		await expect(admin.mutation(api.platform.updateClient, {
			clientId,
			catalogProductKinds: ["print", "print"],
		})).rejects.toThrow(/duplicate catalog product kind/i);

		const clientAdmin = t.withIdentity({
			subject: "owner@catalog.example",
			email: "owner@catalog.example",
		});
		await expect(clientAdmin.mutation(api.platform.updateClient, {
			clientId,
			catalogProductKinds: ["print"],
		})).rejects.toThrow(/not authorized/i);
	});

	test("defaults new tenants to deny-all without rewriting unmigrated rows", async () => {
		const { t, admin } = await setupPlatformAdmin();
		const clientId = await admin.mutation(
			api.platform.createClient,
			clientInput("deny-all.example"),
		);
		const stored = await t.run(async (ctx) => ({
			creator: await ctx.db
				.query("platformClients")
				.withIndex("by_siteUrl", (query) =>
					query.eq("siteUrl", "angelsrest.online")
				)
				.unique(),
			client: await ctx.db.get(clientId),
		}));
		expect(stored.creator?.catalogProductKinds).toBeUndefined();
		expect(stored.client?.catalogProductKinds).toEqual([]);
	});

	test("backfills one tenant idempotently through the internal operator path", async () => {
		const { t } = await setupPlatformAdmin();
		const first = await t.mutation(internal.platform.setCatalogProductKinds, {
			siteUrl: "angelsrest.online",
			catalogProductKinds: ["postcard", "print", "print_set"],
		});
		expect(first).toMatchObject({
			changed: true,
			siteUrl: "angelsrest.online",
			before: null,
			catalogProductKinds: ["print", "print_set", "postcard"],
		});

		await expect(t.mutation(internal.platform.setCatalogProductKinds, {
			siteUrl: "angelsrest.online",
			catalogProductKinds: ["print_set", "postcard", "print"],
		})).resolves.toMatchObject({
			changed: false,
			catalogProductKinds: ["print", "print_set", "postcard"],
		});
		await expect(t.mutation(internal.platform.setCatalogProductKinds, {
			siteUrl: "missing.example",
			catalogProductKinds: [],
		})).rejects.toThrow(/no platformClients row/i);
	});

	test("stores a deny-all or explicit canonical policy when seeding new tenants", async () => {
		const t = convexTest(schema, modules);
		const explicit = await t.mutation(internal.platform.seedClient, {
			...clientInput("seeded.example"),
			catalogProductKinds: ["postcard", "print"],
		});
		const denyAll = await t.mutation(internal.platform.seedClient, {
			...clientInput("seeded-deny-all.example"),
		});
		const stored = await t.run(async (ctx) => ({
			explicit: await ctx.db.get(explicit.id),
			denyAll: await ctx.db.get(denyAll.id),
		}));
		expect(stored.explicit?.catalogProductKinds).toEqual(["print", "postcard"]);
		expect(stored.denyAll?.catalogProductKinds).toEqual([]);

		await expect(t.mutation(internal.platform.seedClient, {
			...clientInput("seeded.example"),
			catalogProductKinds: ["merchandise"],
		})).resolves.toMatchObject({ created: false, id: explicit.id });
		await expect(t.run(async (ctx) => await ctx.db.get(explicit.id))).resolves
			.toMatchObject({ catalogProductKinds: ["print", "postcard"] });
	});
});
