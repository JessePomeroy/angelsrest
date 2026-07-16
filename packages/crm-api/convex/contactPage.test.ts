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
const COMPLETE_CONTACT = {
	heading: "Get in touch",
	intro: "Tell me what you would like to make together.",
	email: "hello@example.com",
	phone: "555-0100",
	availability: "Now booking autumn sessions.",
	responseTime: "Replies usually arrive within two business days.",
	confirmationMessage: "Message received — I will be in touch soon.",
	bookingEnabled: true,
	bookingUrl: "https://cal.com/maggie/session",
	bookingLabel: "Book a session",
	bookingIntro: "Choose a time or send an inquiry below.",
	inquiryChoices: ["Portrait session", "Print inquiry"],
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

describe("typed Contact & Booking content", () => {
	test("keeps contact content in its own tenant singleton", async () => {
		const t = await setup();
		const admin = asAdmin(t, SITE_A.adminEmail);
		await admin.mutation(api.content.saveSiteSettingsDraft, {
			siteUrl: SITE_A.siteUrl,
			payload: { artistName: "Maggie" },
		});
		await admin.mutation(api.content.saveContactPageDraft, {
			siteUrl: SITE_A.siteUrl,
			payload: { heading: "Contact" },
		});

		const kinds = await t.run(async (ctx) =>
			(await ctx.db.query("contentDocuments").collect())
				.map((document) => document.kind)
				.sort(),
		);
		expect(kinds).toEqual(["contactPage", "siteSettings"]);
	});

	test("requires tenant membership for editor reads and writes", async () => {
		const t = await setup();
		const adminA = asAdmin(t, SITE_A.adminEmail);
		const adminB = asAdmin(t, SITE_B.adminEmail);
		await adminA.mutation(api.content.saveContactPageDraft, {
			siteUrl: SITE_A.siteUrl,
			payload: { heading: "Private draft" },
		});

		await expect(
			adminB.query(api.content.getContactPageEditorState, {
				siteUrl: SITE_A.siteUrl,
			}),
		).rejects.toThrow(/not authorized/i);
		await expect(
			adminB.mutation(api.content.saveContactPageDraft, {
				siteUrl: SITE_A.siteUrl,
				payload: COMPLETE_CONTACT,
			}),
		).rejects.toThrow(/not authorized/i);
	});

	test("keeps retries idempotent and rejects stale saves", async () => {
		const t = await setup();
		const admin = asAdmin(t, SITE_A.adminEmail);
		const first = await admin.mutation(api.content.saveContactPageDraft, {
			siteUrl: SITE_A.siteUrl,
			payload: COMPLETE_CONTACT,
		});
		const retry = await admin.mutation(api.content.saveContactPageDraft, {
			siteUrl: SITE_A.siteUrl,
			expectedDraftRevisionId: first.revisionId,
			payload: { ...COMPLETE_CONTACT },
		});
		expect(retry.revisionId).toBe(first.revisionId);

		const second = await admin.mutation(api.content.saveContactPageDraft, {
			siteUrl: SITE_A.siteUrl,
			expectedDraftRevisionId: first.revisionId,
			payload: { ...COMPLETE_CONTACT, heading: "New draft" },
		});
		await expect(
			admin.mutation(api.content.saveContactPageDraft, {
				siteUrl: SITE_A.siteUrl,
				expectedDraftRevisionId: first.revisionId,
				payload: { ...COMPLETE_CONTACT, heading: "Stale draft" },
			}),
		).rejects.toThrow(/conflict/i);
		expect(second.revisionId).not.toBe(first.revisionId);
	});

	test("allows incomplete drafts but validates bounded public destinations", async () => {
		const t = await setup();
		const admin = asAdmin(t, SITE_A.adminEmail);
		await expect(
			admin.mutation(api.content.saveContactPageDraft, {
				siteUrl: SITE_A.siteUrl,
				payload: { intro: "x".repeat(2_001) },
			}),
		).rejects.toThrow(/2000 characters or fewer/i);
		const incomplete = await admin.mutation(api.content.saveContactPageDraft, {
			siteUrl: SITE_A.siteUrl,
			payload: { heading: "Still writing" },
		});
		await expect(
			admin.mutation(api.content.publishContactPage, {
				siteUrl: SITE_A.siteUrl,
				draftRevisionId: incomplete.revisionId,
			}),
		).rejects.toThrow(/introduction is required/i);

		const invalidEmail = await admin.mutation(api.content.saveContactPageDraft, {
			siteUrl: SITE_A.siteUrl,
			expectedDraftRevisionId: incomplete.revisionId,
			payload: {
				...COMPLETE_CONTACT,
				email: "not-an-email",
			},
		});
		await expect(
			admin.mutation(api.content.publishContactPage, {
				siteUrl: SITE_A.siteUrl,
				draftRevisionId: invalidEmail.revisionId,
			}),
		).rejects.toThrow(/valid email address/i);

		const invalidUrl = await admin.mutation(api.content.saveContactPageDraft, {
			siteUrl: SITE_A.siteUrl,
			expectedDraftRevisionId: invalidEmail.revisionId,
			payload: { ...COMPLETE_CONTACT, bookingUrl: "javascript:alert(1)" },
		});
		await expect(
			admin.mutation(api.content.publishContactPage, {
				siteUrl: SITE_A.siteUrl,
				draftRevisionId: invalidUrl.revisionId,
			}),
		).rejects.toThrow(/valid public URL/i);

		const duplicate = await admin.mutation(api.content.saveContactPageDraft, {
			siteUrl: SITE_A.siteUrl,
			expectedDraftRevisionId: invalidUrl.revisionId,
			payload: {
				...COMPLETE_CONTACT,
				inquiryChoices: ["Print inquiry", "print inquiry"],
			},
		});
		await expect(
			admin.mutation(api.content.publishContactPage, {
				siteUrl: SITE_A.siteUrl,
				draftRevisionId: duplicate.revisionId,
			}),
		).rejects.toThrow(/must be unique/i);
	});

	test("publishes a normalized public projection without operational settings", async () => {
		const t = await setup();
		const admin = asAdmin(t, SITE_A.adminEmail);
		const draft = await admin.mutation(api.content.saveContactPageDraft, {
			siteUrl: SITE_A.siteUrl,
			payload: {
				...COMPLETE_CONTACT,
				heading: "  Get in touch  ",
				email: "  hello@example.com  ",
			},
		});
		await admin.mutation(api.content.publishContactPage, {
			siteUrl: SITE_A.siteUrl,
			draftRevisionId: draft.revisionId,
		});

		const published = await t.query(
			api.content.getPublishedContactPageWithRevision,
			{ siteUrl: SITE_A.siteUrl },
		);
		expect(published).toMatchObject({
			revisionId: draft.revisionId,
			payload: {
				heading: "Get in touch",
				email: "hello@example.com",
				booking: {
					enabled: true,
					url: "https://cal.com/maggie/session",
				},
			},
		});
		expect(published?.payload).not.toHaveProperty("recipientEmail");
		expect(published?.payload).not.toHaveProperty("turnstileSecret");
		expect(Object.keys(published ?? {}).sort()).toEqual([
			"payload",
			"publishedAt",
			"revisionId",
		]);
	});

	test("keeps a disabled booking URL out of the public projection", async () => {
		const t = await setup();
		const admin = asAdmin(t, SITE_A.adminEmail);
		const draft = await admin.mutation(api.content.saveContactPageDraft, {
			siteUrl: SITE_A.siteUrl,
			payload: { ...COMPLETE_CONTACT, bookingEnabled: false },
		});
		await admin.mutation(api.content.publishContactPage, {
			siteUrl: SITE_A.siteUrl,
			draftRevisionId: draft.revisionId,
		});
		const published = await t.query(
			api.content.getPublishedContactPageWithRevision,
			{ siteUrl: SITE_A.siteUrl },
		);
		expect(published?.payload.booking).toEqual({
			enabled: false,
			url: undefined,
			label: "Book a session",
			intro: "Choose a time or send an inquiry below.",
		});
	});
});
