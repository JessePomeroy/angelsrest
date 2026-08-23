import { describe, expect, test } from "vitest";
import type { Id } from "./_generated/dataModel";
import {
	ANGELS_REST_ABOUT_PARITY_SEED,
	ANGELS_REST_ABOUT_LOCAL_PORTRAIT,
	ANGELS_REST_CONTACT_PARITY_SEED,
	createSanityAboutContactPlan,
	digestSanityAboutContactPlan,
	requireSanityAboutContactPlan,
	type SanityAboutContactBuildOptions,
	type SanityAboutContactSource,
} from "./helpers/sanityAboutContactPlan";

const LOCAL_PORTRAIT_ID = "media-local-portrait" as Id<"mediaAssets">;
const SANITY_PORTRAIT_ID = "media-sanity-portrait" as Id<"mediaAssets">;
const SANITY_PORTRAIT_REF = "image-portrait123-1440x2160-jpg";
const MEDIA_RECEIPT = "b".repeat(64);

function sourceFixture(): SanityAboutContactSource {
	return {
		about: [
			{
				_id: "about-one",
				_rev: "about-revision-1",
				_type: "about",
				name: "Jesse Pomeroy",
				heading: "about",
				title: "Photographer",
				portrait: { asset: { _ref: SANITY_PORTRAIT_REF } },
				shortBio: "A short introduction.",
				plainBio: "First biography paragraph.\n\nSecond biography paragraph.",
				fullBio: [],
				sections: [
					{
						_key: "practice",
						title: "Practice",
						items: ["Photography", "Web development"],
					},
				],
				highlights: [{ _key: "location", label: "Based in", value: "Michigan" }],
				social: {
					instagram: "https://instagram.com/example",
					twitter: "https://x.com/example",
				},
				seo: { description: "About Jesse Pomeroy." },
			},
		],
		contact: [
			{
				_id: "contact-one",
				_rev: "contact-revision-1",
				_type: "contactPage",
				heading: "Get in Touch",
				intro: [
					{
						_type: "block",
						style: "normal",
						markDefs: [],
						children: [
							{
								_type: "span",
								text: "Let's work together.",
								marks: [],
							},
						],
					},
				],
				email: "hello@angelsrest.online",
				phone: "555-0100",
				bookingEnabled: true,
				bookingUrl: "https://cal.com/source/session",
				bookingTypes: [{ name: "Portrait", duration: "1 hour" }],
			},
		],
	};
}

function options(): SanityAboutContactBuildOptions {
	return {
		migrationId: "R6-about-contact-fixture",
		siteUrl: "angelsrest.online",
		source: {
			projectId: "n7rvza4g",
			dataset: "production",
			perspective: "published",
		},
		decisions: {
			id: "about-contact-decisions-1",
			aboutHeading: { action: "use-source-owner-approved" },
			aboutBiography: { action: "use-plain-bio-owner-approved" },
			aboutPortrait: {
				action: "use-local-portrait-owner-approved",
				targetMediaAssetId: LOCAL_PORTRAIT_ID,
				targetWorkerAssetId: "123e4567-e89b-42d3-a456-426614174000",
				targetReceiptSha256: MEDIA_RECEIPT,
				altText: "Portrait of Jesse Pomeroy.",
			},
			aboutSocial: { action: "defer-to-site-settings-owner-approved" },
			aboutSeoImage: { action: "keep-host-fallback-owner-approved" },
			aboutSeoDescription: { action: "use-source-owner-approved" },
			contactIntro: { action: "accept-source-plain-paragraphs-owner-approved" },
			contactStaticCopy: { action: "accept-host-seed-owner-approved" },
			contactBooking: { action: "use-host-seed-booking-owner-approved" },
			contactBookingTypes: { action: "omit-owner-approved" },
		},
	};
}

function copySource() {
	return structuredClone(sourceFixture()) as {
		about: Array<Record<string, unknown>>;
		contact: Array<Record<string, unknown>>;
	};
}

describe("Sanity About/Contact fixed source plan", () => {
	test("builds the exact ordered pair with every ambiguous mapping bound to a decision", async () => {
		const plan = createSanityAboutContactPlan(sourceFixture(), options());

		expect(plan.entries.map(({ kind }) => kind)).toEqual(["aboutPage", "contactPage"]);
		expect(plan.entries).toMatchObject([
			{
				kind: "aboutPage",
				sourceId: "about-one",
				sourceRevision: "about-revision-1",
				payload: {
					displayName: "Jesse Pomeroy",
					biography: "First biography paragraph.\n\nSecond biography paragraph.",
					portraits: [{ assetId: LOCAL_PORTRAIT_ID, altText: "Portrait of Jesse Pomeroy." }],
				},
			},
			{
				kind: "contactPage",
				sourceId: "contact-one",
				sourceRevision: "contact-revision-1",
				payload: {
					intro: "Let's work together.",
					confirmationMessage: ANGELS_REST_CONTACT_PARITY_SEED.confirmationMessage,
					bookingEnabled: true,
					bookingUrl: ANGELS_REST_CONTACT_PARITY_SEED.bookingUrl,
					bookingLabel: ANGELS_REST_CONTACT_PARITY_SEED.bookingLabel,
					bookingIntro: ANGELS_REST_CONTACT_PARITY_SEED.bookingIntro,
					inquiryChoices: [],
				},
			},
		]);
		expect(plan.decisionSet).toMatchObject({
			aboutHeading: { action: "use-source-owner-approved", value: "about" },
			aboutBiography: { action: "use-plain-bio-owner-approved" },
			aboutPortrait: {
				action: "use-local-portrait-owner-approved",
				localPath: ANGELS_REST_ABOUT_LOCAL_PORTRAIT.path,
				localSha256: ANGELS_REST_ABOUT_LOCAL_PORTRAIT.sha256,
				sourceAssetRef: SANITY_PORTRAIT_REF,
			},
			aboutSocial: { action: "defer-to-site-settings-owner-approved" },
			aboutSeoImage: {
				action: "keep-host-fallback-owner-approved",
				fallbackPath: "/og-image.jpg",
			},
			aboutSeoDescription: {
				action: "use-source-owner-approved",
				value: "About Jesse Pomeroy.",
			},
			contactIntro: { action: "accept-source-plain-paragraphs-owner-approved" },
			contactStaticCopy: {
				action: "accept-host-seed-owner-approved",
				sourceSha256: ANGELS_REST_CONTACT_PARITY_SEED.sha256,
			},
			contactBooking: {
				action: "use-host-seed-booking-owner-approved",
				sourceUrl: "https://cal.com/source/session",
			},
			contactBookingTypes: { action: "omit-owner-approved" },
		});

		const firstDigest = await digestSanityAboutContactPlan(plan);
		const secondDigest = await digestSanityAboutContactPlan(
			createSanityAboutContactPlan(sourceFixture(), options()),
		);
		expect(firstDigest).toMatch(/^[a-f0-9]{64}$/);
		expect(secondDigest).toBe(firstDigest);
		await expect(requireSanityAboutContactPlan(plan, firstDigest)).resolves.toBe(firstDigest);
		await expect(requireSanityAboutContactPlan(plan, "0".repeat(64))).rejects.toThrow(
			"does not match canonical bytes",
		);
	});

	test("binds exact host fallbacks when live About heading and SEO are absent", async () => {
		const source = copySource();
		delete source.about[0].heading;
		source.about[0].seo = null;
		const selected = options();
		selected.decisions.aboutHeading = { action: "use-host-fallback-owner-approved" };
		selected.decisions.aboutSeoDescription = {
			action: "use-host-fallback-owner-approved",
		};

		const plan = createSanityAboutContactPlan(source, selected);
		const about = plan.entries[0];
		if (about?.kind !== "aboutPage") throw new Error("Expected About entry");
		expect(about.payload).toMatchObject(ANGELS_REST_ABOUT_PARITY_SEED);
		expect(plan.decisionSet).toMatchObject({
			aboutHeading: {
				action: "use-host-fallback-owner-approved",
				sourceValueCanonical: "null",
			},
			aboutSeoDescription: {
				action: "use-host-fallback-owner-approved",
				sourceValueCanonical: "null",
			},
		});

		const tampered = structuredClone(plan);
		tampered.decisionSet.aboutHeading.value = "invented";
		const tamperedAbout = tampered.entries[0];
		if (tamperedAbout?.kind !== "aboutPage") throw new Error("Expected About entry");
		tamperedAbout.payload.heading = "invented";
		await expect(digestSanityAboutContactPlan(tampered)).rejects.toThrow(
			"About heading decision binding is invalid",
		);
	});

	test("supports an explicitly selected Sanity portrait and Sanity booking URL", () => {
		const selected = options();
		selected.decisions.aboutPortrait = {
			action: "use-sanity-portrait-owner-approved",
			sourceSha256: "a".repeat(64),
			targetMediaAssetId: SANITY_PORTRAIT_ID,
			targetWorkerAssetId: "123e4567-e89b-42d3-a456-426614174001",
			targetReceiptSha256: MEDIA_RECEIPT,
			altText: "Jesse standing outdoors.",
		};
		selected.decisions.contactBooking = { action: "use-sanity-booking-owner-approved" };

		const plan = createSanityAboutContactPlan(sourceFixture(), selected);
		const aboutEntry = plan.entries[0];
		const contactEntry = plan.entries[1];
		if (aboutEntry?.kind !== "aboutPage" || contactEntry?.kind !== "contactPage") {
			throw new Error("Expected the fixed About/Contact pair");
		}
		expect(aboutEntry.payload.portraits).toEqual([
			{
				key: "primary-portrait",
				assetId: SANITY_PORTRAIT_ID,
				altText: "Jesse standing outdoors.",
			},
		]);
		expect(contactEntry.payload).toMatchObject({
			bookingEnabled: true,
			bookingUrl: "https://cal.com/source/session",
		});
	});

	test("stops on an inexact source pair, unapproved rich biography, or rich Contact intro", () => {
		const duplicate = copySource();
		duplicate.about.push(structuredClone(duplicate.about[0]));
		expect(() => createSanityAboutContactPlan(duplicate, options())).toThrow(
			"Exactly one published About",
		);

		const richBiography = copySource();
		richBiography.about[0].fullBio = [
			{ _type: "block", children: [{ _type: "span", text: "Rich text" }] },
		];
		expect(() => createSanityAboutContactPlan(richBiography, options())).not.toThrow();
		richBiography.about[0].plainBio = null;
		expect(() => createSanityAboutContactPlan(richBiography, options())).toThrow(
			"Nonempty About fullBio",
		);

		const missingIntroduction = copySource();
		missingIntroduction.about[0].shortBio = null;
		expect(() => createSanityAboutContactPlan(missingIntroduction, options())).toThrow(
			"About short biography is required",
		);

		const richIntro = copySource();
		richIntro.contact[0].intro = [
			{
				_type: "block",
				style: "h2",
				markDefs: [],
				children: [{ _type: "span", text: "Heading", marks: [] }],
			},
		];
		expect(() => createSanityAboutContactPlan(richIntro, options())).toThrow(
			"unsupported rich content",
		);

		const tooManyParagraphs = copySource();
		tooManyParagraphs.contact[0].intro = Array.from({ length: 21 }, (_, index) => ({
			_type: "block",
			style: "normal",
			markDefs: [],
			children: [{ _type: "span", text: `Paragraph ${index + 1}`, marks: [] }],
		}));
		expect(() => createSanityAboutContactPlan(tooManyParagraphs, options())).toThrow(
			"at most 20",
		);

		const unsupportedBooking = copySource();
		unsupportedBooking.contact[0].bookingUrl = "https://booking.example/session";
		const sourceBooking = options();
		sourceBooking.decisions.contactBooking = {
			action: "use-sanity-booking-owner-approved",
		};
		expect(() => createSanityAboutContactPlan(unsupportedBooking, sourceBooking)).toThrow(
			"must be a Cal.com URL",
		);
	});

	test("preserves Contact hard breaks inside a plain Portable Text paragraph", () => {
		const source = copySource();
		source.contact[0].intro = [
			{
				_type: "block",
				style: "normal",
				markDefs: [],
				children: [
					{
						_type: "span",
						text: "First line.\nSecond line.\r\nThird line.",
						marks: [],
					},
				],
			},
		];

		const plan = createSanityAboutContactPlan(source, options());
		const contact = plan.entries[1];
		if (contact?.kind !== "contactPage") throw new Error("Expected Contact entry");
		expect(contact.payload.intro).toBe("First line.\nSecond line.\nThird line.");
		expect(plan.decisionSet.contactIntro.paragraphs).toEqual([
			"First line.\nSecond line.\nThird line.",
		]);
	});
});
