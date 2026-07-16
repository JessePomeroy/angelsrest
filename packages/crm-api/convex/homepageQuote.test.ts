/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
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

describe("typed Homepage Quote content slot", () => {
	test("keeps the quote separate from the site settings singleton", async () => {
		const t = await setup();
		const admin = asAdmin(t, SITE_A.adminEmail);
		await admin.mutation(api.content.saveSiteSettingsDraft, {
			siteUrl: SITE_A.siteUrl,
			payload: { artistName: "Maggie" },
		});
		await admin.mutation(api.content.saveHomepageQuoteDraft, {
			siteUrl: SITE_A.siteUrl,
			payload: { text: "Look closely." },
		});

		const documents = await t.run(async (ctx) =>
			await ctx.db.query("contentDocuments").collect(),
		);
		expect(documents.map((document) => document.kind).sort()).toEqual([
			"homepageQuote",
			"siteSettings",
		]);
	});

	test("enforces tenant ownership for reads and writes", async () => {
		const t = await setup();
		const adminA = asAdmin(t, SITE_A.adminEmail);
		const adminB = asAdmin(t, SITE_B.adminEmail);
		await adminA.mutation(api.content.saveHomepageQuoteDraft, {
			siteUrl: SITE_A.siteUrl,
			payload: { text: "Private draft" },
		});

		await expect(
			adminB.query(api.content.getHomepageQuoteEditorState, {
				siteUrl: SITE_A.siteUrl,
			}),
		).rejects.toThrow();
		await expect(
			adminB.mutation(api.content.saveHomepageQuoteDraft, {
				siteUrl: SITE_A.siteUrl,
				payload: { text: "Cross-tenant overwrite" },
			}),
		).rejects.toThrow();
	});

	test("keeps retries idempotent and rejects stale saves", async () => {
		const t = await setup();
		const admin = asAdmin(t, SITE_A.adminEmail);
		const first = await admin.mutation(api.content.saveHomepageQuoteDraft, {
			siteUrl: SITE_A.siteUrl,
			payload: { text: "Draft", attribution: "Artist" },
		});
		const retry = await admin.mutation(api.content.saveHomepageQuoteDraft, {
			siteUrl: SITE_A.siteUrl,
			expectedDraftRevisionId: first.revisionId,
			payload: { text: "Draft", attribution: "Artist" },
		});
		expect(retry.revisionId).toBe(first.revisionId);

		const second = await admin.mutation(api.content.saveHomepageQuoteDraft, {
			siteUrl: SITE_A.siteUrl,
			expectedDraftRevisionId: first.revisionId,
			payload: { text: "New draft", attribution: "Artist" },
		});
		await expect(
			admin.mutation(api.content.saveHomepageQuoteDraft, {
				siteUrl: SITE_A.siteUrl,
				expectedDraftRevisionId: first.revisionId,
				payload: { text: "Stale draft", attribution: "Artist" },
			}),
		).rejects.toThrow(/conflict/i);
		expect(second.revisionId).not.toBe(first.revisionId);
	});

	test("allows incomplete drafts but publishes only a complete bounded quote", async () => {
		const t = await setup();
		const admin = asAdmin(t, SITE_A.adminEmail);
		const incomplete = await admin.mutation(
			api.content.saveHomepageQuoteDraft,
			{
				siteUrl: SITE_A.siteUrl,
				payload: { text: "Still writing" },
			},
		);
		await expect(
			admin.mutation(api.content.publishHomepageQuote, {
				siteUrl: SITE_A.siteUrl,
				draftRevisionId: incomplete.revisionId,
			}),
		).rejects.toThrow(/attribution is required/i);

		const complete = await admin.mutation(api.content.saveHomepageQuoteDraft, {
			siteUrl: SITE_A.siteUrl,
			expectedDraftRevisionId: incomplete.revisionId,
			payload: { text: "  Look closely.  ", attribution: "  Maggie  " },
		});
		await admin.mutation(api.content.publishHomepageQuote, {
			siteUrl: SITE_A.siteUrl,
			draftRevisionId: complete.revisionId,
		});

		const published = await t.query(
			api.content.getPublishedHomepageQuoteWithRevision,
			{ siteUrl: SITE_A.siteUrl },
		);
		expect(published).toMatchObject({
			revisionId: complete.revisionId,
			payload: { text: "Look closely.", attribution: "Maggie" },
		});
		expect(Object.keys(published ?? {}).sort()).toEqual([
			"payload",
			"publishedAt",
			"revisionId",
		]);
	});

	test("discards only the active draft and preserves the publication", async () => {
		const t = await setup();
		const admin = asAdmin(t, SITE_A.adminEmail);
		const first = await admin.mutation(api.content.saveHomepageQuoteDraft, {
			siteUrl: SITE_A.siteUrl,
			payload: { text: "Published", attribution: "Artist" },
		});
		await admin.mutation(api.content.publishHomepageQuote, {
			siteUrl: SITE_A.siteUrl,
			draftRevisionId: first.revisionId,
		});
		const draft = await admin.mutation(api.content.saveHomepageQuoteDraft, {
			siteUrl: SITE_A.siteUrl,
			payload: { text: "Discard me" },
		});
		await admin.mutation(api.content.discardHomepageQuoteDraft, {
			siteUrl: SITE_A.siteUrl,
			draftRevisionId: draft.revisionId,
		});

		const editor = await admin.query(api.content.getHomepageQuoteEditorState, {
			siteUrl: SITE_A.siteUrl,
		});
		expect(editor?.draft).toBeNull();
		expect(editor?.published?.payload).toEqual({
			text: "Published",
			attribution: "Artist",
		});
	});
});
