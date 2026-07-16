/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const SITE_A = {
	name: "Site A",
	siteUrl: "site-a.example",
	adminEmail: "admin-a@example.com",
};
const SITE_B = {
	name: "Site B",
	siteUrl: "site-b.example",
	adminEmail: "admin-b@example.com",
};
const COMPLETE_SETTINGS = {
	artistName: "Maggie Helena",
	siteTitle: "Reflecting Pool",
	tagline: "Photography in motion",
	socialLinks: [
		{ platform: "Instagram", url: "https://instagram.com/example" },
	],
	seoDescription: "Photography, modeling, and visual work by Maggie Helena.",
};

async function setup() {
	const t = convexTest(schema, modules);
	for (const site of [SITE_A, SITE_B]) {
		await t.mutation(internal.platform.seedClient, {
			name: site.name,
			email: site.adminEmail,
			siteUrl: site.siteUrl,
			tier: "full",
			subscriptionStatus: "active",
			adminEmails: [site.adminEmail],
			role: "client",
		});
	}
	return t;
}

function asAdmin(t: Awaited<ReturnType<typeof setup>>, email: string) {
	return t.withIdentity({ subject: email, email });
}

describe("typed site settings CMS foundation", () => {
	test("keeps one singleton document while saving immutable draft revisions", async () => {
		const t = await setup();
		const admin = asAdmin(t, SITE_A.adminEmail);
		const first = await admin.mutation(api.content.saveSiteSettingsDraft, {
			siteUrl: SITE_A.siteUrl,
			payload: { artistName: "Draft one" },
		});
		const second = await admin.mutation(api.content.saveSiteSettingsDraft, {
			siteUrl: SITE_A.siteUrl,
			expectedDraftRevisionId: first.revisionId,
			payload: { artistName: "Draft two" },
		});

		const stored = await t.run(async (ctx) => ({
			documents: await ctx.db.query("contentDocuments").take(3),
			revisions: await ctx.db.query("contentRevisions").take(3),
		}));
		expect(stored.documents).toHaveLength(1);
		expect(stored.revisions).toHaveLength(2);
		expect(stored.documents[0]?.draftRevisionId).toBe(second.revisionId);
		expect(stored.revisions[0]?._id).toBe(first.revisionId);
	});

	test("requires authentication and stored site membership for editor reads and writes", async () => {
		const t = await setup();
		await expect(
			t.query(api.content.getSiteSettingsEditorState, { siteUrl: SITE_A.siteUrl }),
		).rejects.toThrow(/Not authenticated/);
		await expect(
			asAdmin(t, SITE_A.adminEmail).mutation(api.content.saveSiteSettingsDraft, {
				siteUrl: SITE_B.siteUrl,
				payload: COMPLETE_SETTINGS,
			}),
		).rejects.toThrow(/Not authorized/);
	});

	test("never exposes drafts through the public query", async () => {
		const t = await setup();
		const admin = asAdmin(t, SITE_A.adminEmail);
		const draft = await admin.mutation(api.content.saveSiteSettingsDraft, {
			siteUrl: SITE_A.siteUrl,
			payload: COMPLETE_SETTINGS,
		});

		expect(
			await t.query(api.content.getPublishedSiteSettings, {
				siteUrl: SITE_A.siteUrl,
			}),
		).toBeNull();

		await admin.mutation(api.content.publishSiteSettings, {
			siteUrl: SITE_A.siteUrl,
			draftRevisionId: draft.revisionId,
		});
		expect(
			await t.query(api.content.getPublishedSiteSettings, {
				siteUrl: SITE_A.siteUrl,
			}),
		).toEqual(COMPLETE_SETTINGS);

		const publicValue = await t.query(api.content.getPublishedSiteSettings, {
			siteUrl: SITE_A.siteUrl,
		});
		expect(publicValue).not.toHaveProperty("createdBy");
		expect(publicValue).not.toHaveProperty("revisionId");
	});

	test("rejects partial or invalid publication while preserving the live revision", async () => {
		const t = await setup();
		const admin = asAdmin(t, SITE_A.adminEmail);
		const complete = await admin.mutation(api.content.saveSiteSettingsDraft, {
			siteUrl: SITE_A.siteUrl,
			payload: COMPLETE_SETTINGS,
		});
		await admin.mutation(api.content.publishSiteSettings, {
			siteUrl: SITE_A.siteUrl,
			draftRevisionId: complete.revisionId,
		});

		const invalid = await admin.mutation(api.content.saveSiteSettingsDraft, {
			siteUrl: SITE_A.siteUrl,
			payload: {
				artistName: "Changed",
				siteTitle: "Reflecting Pool",
				tagline: "Still a draft",
				socialLinks: [{ platform: "Instagram", url: "not-a-url" }],
			},
		});
		await expect(
			admin.mutation(api.content.publishSiteSettings, {
				siteUrl: SITE_A.siteUrl,
				draftRevisionId: invalid.revisionId,
			}),
		).rejects.toThrow(/valid public URL|SEO description is required/);

		expect(
			await t.query(api.content.getPublishedSiteSettings, {
				siteUrl: SITE_A.siteUrl,
			}),
		).toEqual(COMPLETE_SETTINGS);
	});

	test("rejects stale saves, publishes, and discards instead of overwriting", async () => {
		const t = await setup();
		const admin = asAdmin(t, SITE_A.adminEmail);
		const first = await admin.mutation(api.content.saveSiteSettingsDraft, {
			siteUrl: SITE_A.siteUrl,
			payload: COMPLETE_SETTINGS,
		});
		const second = await admin.mutation(api.content.saveSiteSettingsDraft, {
			siteUrl: SITE_A.siteUrl,
			expectedDraftRevisionId: first.revisionId,
			payload: { ...COMPLETE_SETTINGS, tagline: "Newer draft" },
		});

		await expect(
			admin.mutation(api.content.saveSiteSettingsDraft, {
				siteUrl: SITE_A.siteUrl,
				expectedDraftRevisionId: first.revisionId,
				payload: { ...COMPLETE_SETTINGS, tagline: "Stale overwrite" },
			}),
		).rejects.toThrow(/Draft conflict/);
		await expect(
			admin.mutation(api.content.publishSiteSettings, {
				siteUrl: SITE_A.siteUrl,
				draftRevisionId: first.revisionId,
			}),
		).rejects.toThrow(/Draft conflict/);
		await expect(
			admin.mutation(api.content.discardSiteSettingsDraft, {
				siteUrl: SITE_A.siteUrl,
				draftRevisionId: first.revisionId,
			}),
		).rejects.toThrow(/Draft conflict/);

		await admin.mutation(api.content.discardSiteSettingsDraft, {
			siteUrl: SITE_A.siteUrl,
			draftRevisionId: second.revisionId,
		});
		const state = await admin.query(api.content.getSiteSettingsEditorState, {
			siteUrl: SITE_A.siteUrl,
		});
		expect(state?.draft).toBeNull();
	});

	test("rejects cross-tenant revision ids even for a valid site admin", async () => {
		const t = await setup();
		const adminA = asAdmin(t, SITE_A.adminEmail);
		const adminB = asAdmin(t, SITE_B.adminEmail);
		const draftA = await adminA.mutation(api.content.saveSiteSettingsDraft, {
			siteUrl: SITE_A.siteUrl,
			payload: COMPLETE_SETTINGS,
		});
		const draftB = await adminB.mutation(api.content.saveSiteSettingsDraft, {
			siteUrl: SITE_B.siteUrl,
			payload: { ...COMPLETE_SETTINGS, siteTitle: "Site B" },
		});

		await expect(
			adminB.mutation(api.content.publishSiteSettings, {
				siteUrl: SITE_B.siteUrl,
				draftRevisionId: draftA.revisionId as Id<"contentRevisions">,
			}),
		).rejects.toThrow(/Draft conflict|ownership mismatch/);
		await adminB.mutation(api.content.publishSiteSettings, {
			siteUrl: SITE_B.siteUrl,
			draftRevisionId: draftB.revisionId,
		});
	});
});
