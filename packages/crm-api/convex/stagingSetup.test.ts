/// <reference types="vite/client" />
// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
afterEach(() => vi.unstubAllEnvs());

function staging() {
	vi.stubEnv("CONVEX_SITE_URL", "https://rosy-firefly-366.convex.site");
	vi.stubEnv("SITE_URL", "https://staging.angelsrest.online");
}

test.each([undefined, "https://loyal-swan-967.convex.site", "https://unknown.convex.site"])(
	"operator setup refuses every other backend before writing: %s", async (backend) => {
		staging(); vi.stubEnv("CONVEX_SITE_URL", backend);
		const t = convexTest(schema, modules);
		await expect(t.mutation(internal.stagingSetup.bootstrap, {})).rejects.toThrow("isolated deployment");
		await expect(t.mutation(internal.stagingSetup.seedSiteSettings, {})).rejects.toThrow("isolated deployment");
		expect(await t.run(ctx => ctx.db.query("platformClients").take(1))).toEqual([]);
		expect(await t.run(ctx => ctx.db.query("contentDocuments").take(1))).toEqual([]);
	},
);

test("setup also requires the staging auth origin and a fresh bootstrap credential", async () => {
	staging(); vi.stubEnv("SITE_URL", "https://angelsrest.online");
	const t = convexTest(schema, modules);
	await expect(t.mutation(internal.stagingSetup.bootstrap, {})).rejects.toThrow("isolated deployment");
	staging(); vi.stubEnv("STAGING_BOOTSTRAP_PASSWORD_HASH", "");
	await expect(t.mutation(internal.stagingSetup.bootstrap, {})).rejects.toThrow("credential is unavailable");
	expect(await t.run(ctx => ctx.db.query("platformClients").take(1))).toEqual([]);
});

test("repeat bootstrap preserves the creator and refuses a populated environment", async () => {
	staging();
	const t = convexTest(schema, modules);
	const clientId = await t.run(ctx => ctx.db.insert("platformClients", {
		siteUrl: "angelsrest.online", name: "Staging", email: "staging-admin@example.invalid",
		tier: "full", role: "creator", subscriptionStatus: "active",
		adminEmails: ["staging-admin@example.invalid"], adminIdentityIds: ["staging|creator"],
	}));
	const before = await t.run(ctx => ctx.db.get(clientId));
	vi.stubEnv("STAGING_BOOTSTRAP_PASSWORD_HASH", "a different credential must never be used");
	expect(await t.mutation(internal.stagingSetup.bootstrap, {})).toEqual({
		created: false, clientId, email: "staging-admin@example.invalid",
	});
	expect(await t.run(ctx => ctx.db.get(clientId))).toEqual(before);
	await t.run(ctx => ctx.db.patch(clientId, { email: "unrelated@example.invalid" }));
	await expect(t.mutation(internal.stagingSetup.bootstrap, {})).rejects.toThrow("preserve its records");
});

test("synthetic settings load publicly and repeat setup preserves operator edits", async () => {
	staging(); const t = convexTest(schema, modules);
	expect(await t.mutation(internal.stagingSetup.seedSiteSettings, {})).toEqual({ created: true });
	expect(await t.query(api.content.getPublishedSiteSettingsWithRevision, { siteUrl: "angelsrest.online" }))
		.toMatchObject({ payload: { siteTitle: "Angel's Rest staging", tagline: "Synthetic test data only" } });
	const before = await t.run(async ctx => ({
		documents: await ctx.db.query("contentDocuments").take(2),
		revisions: await ctx.db.query("contentRevisions").take(2),
		assets: await ctx.db.query("mediaAssets").take(2),
	}));
	expect(before.documents).toHaveLength(1);
	expect(before.revisions).toHaveLength(1);
	expect(before.assets).toHaveLength(1);
	await t.run(ctx => ctx.db.patch(before.documents[0]._id, { updatedBy: "operator" }));
	expect(await t.mutation(internal.stagingSetup.seedSiteSettings, {})).toEqual({ created: false });
	expect(await t.run(ctx => ctx.db.get(before.documents[0]._id))).toMatchObject({ updatedBy: "operator" });
	expect(await t.run(ctx => ctx.db.query("contentRevisions").take(2))).toEqual(before.revisions);
	expect(await t.run(ctx => ctx.db.query("mediaAssets").take(2))).toEqual(before.assets);
});
