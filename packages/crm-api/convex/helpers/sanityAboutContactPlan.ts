import type { Infer } from "convex/values";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import {
	aboutPageDraftPayloadValidator,
	type AboutPageDraftPayload,
	toPublishedAboutPage,
} from "./aboutPageValidators";
import {
	contactPageDraftPayloadValidator,
	type ContactPageDraftPayload,
	toPublishedContactPage,
} from "./contactPageValidators";
import {
	requireAboutHostShape,
	requireContactHostShape,
} from "./aboutContactHostContract";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const STABLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const REVISION_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
const SANITY_IMAGE_REF_PATTERN = /^image-[A-Za-z0-9]+-\d+x\d+-[A-Za-z0-9]+$/;
const WORKER_ASSET_ID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const ANGELS_REST_ABOUT_LOCAL_PORTRAIT = {
	path: "src/lib/assets/DSCF7533.jpg",
	sha256: "0e94b665f7654c74158daf3aa2c497139c5cb7c4490d72205cfa3babd6dc4eb0",
	width: 1_440,
	height: 2_160,
} as const;

export const ANGELS_REST_CONTACT_PARITY_SEED = {
	sha256: "b72eb4f60ce7c9b3cbc8cfc29fed43a8dedce60d080180a87f594f5d72b84d1c",
	confirmationMessage: "message sent !",
	bookingEnabled: true,
	bookingUrl: "https://cal.com/jesse-s1wmio/photosession",
	bookingLabel: "book a time",
	bookingIntro: "want to book a session or schedule a call?",
	inquiryChoices: [] as string[],
} as const;

export const ANGELS_REST_ABOUT_PARITY_SEED = {
	heading: "about",
	seoDescription:
		"About Jesse Pomeroy — photographer, visual artist, and web developer. Get in touch for inquiries and collaborations.",
} as const;

const sourceIdentityValidator = v.object({
	projectId: v.string(),
	dataset: v.string(),
	perspective: v.literal("published"),
});

const biographyDecisionValidator = v.union(
	v.object({
		action: v.literal("use-plain-bio-owner-approved"),
		sourcePlainBio: v.string(),
		sourceFullBioCanonical: v.string(),
	}),
	v.object({
		action: v.literal("confirmed-absent-owner-approved"),
		sourceFullBioCanonical: v.string(),
	}),
);

const portraitDecisionValidator = v.union(
	v.object({
		action: v.literal("use-local-portrait-owner-approved"),
		sourceAssetRef: v.optional(v.string()),
		localPath: v.string(),
		localSha256: v.string(),
		localWidth: v.number(),
		localHeight: v.number(),
		targetMediaAssetId: v.id("mediaAssets"),
		targetWorkerAssetId: v.string(),
		targetReceiptSha256: v.string(),
		altText: v.string(),
	}),
	v.object({
		action: v.literal("use-sanity-portrait-owner-approved"),
		sourceAssetRef: v.string(),
		sourceSha256: v.string(),
		sourceWidth: v.number(),
		sourceHeight: v.number(),
		targetMediaAssetId: v.id("mediaAssets"),
		targetWorkerAssetId: v.string(),
		targetReceiptSha256: v.string(),
		altText: v.string(),
	}),
);

const aboutSeoImageDecisionValidator = v.union(
	v.object({
		action: v.literal("use-sanity-og-image-owner-approved"),
		sourceValueCanonical: v.string(),
		url: v.string(),
	}),
	v.object({
		action: v.literal("keep-host-fallback-owner-approved"),
		sourceValueCanonical: v.string(),
		fallbackPath: v.literal("/og-image.jpg"),
	}),
);

const contactStaticCopyDecisionValidator = v.object({
	action: v.union(
		v.literal("accept-host-seed-owner-approved"),
		v.literal("owner-replacement"),
	),
	sourceSha256: v.string(),
	confirmationMessage: v.string(),
	bookingLabel: v.string(),
	bookingIntro: v.string(),
	inquiryChoices: v.array(v.string()),
});

const contactBookingDecisionValidator = v.object({
	action: v.union(
		v.literal("use-sanity-booking-owner-approved"),
		v.literal("use-host-seed-booking-owner-approved"),
		v.literal("owner-replacement"),
	),
	sourceEnabled: v.boolean(),
	sourceUrl: v.optional(v.string()),
	enabled: v.boolean(),
	url: v.optional(v.string()),
});

const decisionSetValidator = v.object({
	id: v.string(),
	aboutHeading: v.object({
		action: v.union(
			v.literal("use-source-owner-approved"),
			v.literal("use-host-fallback-owner-approved"),
		),
		sourceValueCanonical: v.string(),
		value: v.string(),
	}),
	aboutBiography: biographyDecisionValidator,
	aboutPortrait: portraitDecisionValidator,
	aboutSeoImage: aboutSeoImageDecisionValidator,
	aboutSeoDescription: v.object({
		action: v.union(
			v.literal("use-source-owner-approved"),
			v.literal("use-host-fallback-owner-approved"),
		),
		sourceValueCanonical: v.string(),
		value: v.string(),
	}),
	aboutSocial: v.object({
		action: v.literal("defer-to-site-settings-owner-approved"),
		sourceValueCanonical: v.string(),
	}),
	contactIntro: v.object({
		action: v.literal("accept-source-plain-paragraphs-owner-approved"),
		sourceValueCanonical: v.string(),
		paragraphs: v.array(v.string()),
	}),
	contactStaticCopy: contactStaticCopyDecisionValidator,
	contactBooking: contactBookingDecisionValidator,
	contactBookingTypes: v.object({
		action: v.literal("omit-owner-approved"),
		sourceValueCanonical: v.string(),
	}),
});

const aboutEntryValidator = v.object({
	kind: v.literal("aboutPage"),
	sourceId: v.string(),
	sourceRevision: v.string(),
	payload: aboutPageDraftPayloadValidator,
});

const contactEntryValidator = v.object({
	kind: v.literal("contactPage"),
	sourceId: v.string(),
	sourceRevision: v.string(),
	payload: contactPageDraftPayloadValidator,
});

export const sanityAboutContactPlanValidator = v.object({
	version: v.literal(1),
	migrationId: v.string(),
	siteUrl: v.string(),
	source: sourceIdentityValidator,
	decisionSet: decisionSetValidator,
	entries: v.array(v.union(aboutEntryValidator, contactEntryValidator)),
});

export type SanityAboutContactPlan = Infer<typeof sanityAboutContactPlanValidator>;

export type SanityAboutContactSource = {
	about: readonly unknown[];
	contact: readonly unknown[];
};

type StaticCopy = {
	confirmationMessage: string;
	bookingLabel: string;
	bookingIntro: string;
	inquiryChoices: readonly string[];
};

export type SanityAboutContactOwnerDecisions = {
	id: string;
	aboutHeading: {
		action: "use-source-owner-approved" | "use-host-fallback-owner-approved";
	};
	aboutBiography:
		| { action: "use-plain-bio-owner-approved" }
		| { action: "confirmed-absent-owner-approved" };
	aboutPortrait:
		| {
				action: "use-local-portrait-owner-approved";
				targetMediaAssetId: Id<"mediaAssets">;
				targetWorkerAssetId: string;
				targetReceiptSha256: string;
				altText: string;
		  }
		| {
				action: "use-sanity-portrait-owner-approved";
				sourceSha256: string;
				targetMediaAssetId: Id<"mediaAssets">;
				targetWorkerAssetId: string;
				targetReceiptSha256: string;
				altText: string;
			  };
	aboutSeoImage:
		| { action: "use-sanity-og-image-owner-approved" }
			| { action: "keep-host-fallback-owner-approved" };
	aboutSeoDescription: {
		action: "use-source-owner-approved" | "use-host-fallback-owner-approved";
	};
	aboutSocial: { action: "defer-to-site-settings-owner-approved" };
	contactIntro: { action: "accept-source-plain-paragraphs-owner-approved" };
	contactStaticCopy:
		| { action: "accept-host-seed-owner-approved" }
		| ({ action: "owner-replacement" } & StaticCopy);
	contactBooking:
		| { action: "use-sanity-booking-owner-approved" }
		| { action: "use-host-seed-booking-owner-approved" }
		| {
				action: "owner-replacement";
				enabled: boolean;
				url?: string;
		  };
	contactBookingTypes: { action: "omit-owner-approved" };
};

export type SanityAboutContactBuildOptions = {
	migrationId: string;
	siteUrl: string;
	source: SanityAboutContactPlan["source"];
	decisions: SanityAboutContactOwnerDecisions;
};

type JsonRecord = Record<string, unknown>;

function canonicalJson(value: unknown): string {
	if (value === null) return "null";
	if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw new Error("Plan contains a non-finite number");
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (typeof value === "object") {
		return `{${Object.entries(value as JsonRecord)
			.filter(([, entry]) => entry !== undefined)
			.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
			.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
			.join(",")}}`;
	}
	throw new Error("Plan contains an unsupported value");
}

function asRecord(value: unknown, label: string): JsonRecord {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${label} must be an object`);
	}
	return value as JsonRecord;
}

function asArray(value: unknown, label: string, maximum: number) {
	if (!Array.isArray(value) || value.length > maximum) {
		throw new Error(`${label} must be an array with at most ${maximum} items`);
	}
	return value;
}

function requiredText(value: unknown, label: string) {
	if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`);
	return value.trim();
}

function optionalText(value: unknown, label: string) {
	if (value === undefined || value === null || value === "") return undefined;
	if (typeof value !== "string") throw new Error(`${label} must be text`);
	return value.trim() || undefined;
}

function calBookingUrl(value: string | undefined, label: string) {
	if (!value) throw new Error(`${label} is required when booking is enabled`);
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		throw new Error(`${label} must be a Cal.com URL`);
	}
	if (
		parsed.protocol !== "https:"
		|| (parsed.hostname !== "cal.com" && parsed.hostname !== "www.cal.com")
		|| parsed.search
		|| parsed.hash
		|| !/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)+$/.test(
			parsed.pathname.replace(/^\/+|\/+$/g, ""),
		)
	) throw new Error(`${label} must be a Cal.com URL`);
	return value;
}

function publicUrl(value: string | undefined, label: string) {
	if (!value) throw new Error(`${label} is required`);
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		throw new Error(`${label} must be a public HTTP URL`);
	}
	if (
		(parsed.protocol !== "https:" && parsed.protocol !== "http:")
		|| parsed.username
		|| parsed.password
	) throw new Error(`${label} must be a public HTTP URL`);
	return value;
}

function requireStableId(value: string, label: string) {
	if (!STABLE_ID_PATTERN.test(value)) throw new Error(`${label} is invalid`);
	return value;
}

function requireRevision(value: string, label: string) {
	if (!REVISION_PATTERN.test(value)) throw new Error(`${label} is invalid`);
	return value;
}

function singleton(value: readonly unknown[], label: string) {
	if (!Array.isArray(value) || value.length !== 1) {
		throw new Error(`Exactly one published ${label} document is required`);
	}
	return asRecord(value[0], label);
}

function sourceIdentity(document: JsonRecord, type: "about" | "contactPage") {
	if (document._type !== type) throw new Error(`Expected a Sanity ${type} document`);
	return {
		sourceId: requireStableId(requiredText(document._id, `${type} source ID`), `${type} source ID`),
		sourceRevision: requireRevision(
			requiredText(document._rev, `${type} source revision`),
			`${type} source revision`,
		),
	};
}

function portraitAssetRef(value: unknown) {
	if (value === undefined || value === null) return undefined;
	const portrait = asRecord(value, "About portrait");
	const asset = asRecord(portrait.asset, "About portrait asset");
	const reference = requiredText(asset._ref, "About portrait asset reference");
	if (!SANITY_IMAGE_REF_PATTERN.test(reference)) {
		throw new Error("About portrait asset reference is invalid");
	}
	return reference;
}

function sanityImageDimensions(reference: string) {
	const match = reference.match(/^image-[A-Za-z0-9]+-(\d+)x(\d+)-[A-Za-z0-9]+$/);
	if (!match) throw new Error("About portrait asset dimensions are invalid");
	const width = Number(match[1]);
	const height = Number(match[2]);
	if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0) {
		throw new Error("About portrait asset dimensions are invalid");
	}
	return { width, height };
}

function aboutSections(value: unknown): NonNullable<AboutPageDraftPayload["sections"]> {
	if (value === undefined || value === null) return [];
	return asArray(value, "About sections", 12).map((entry, index) => {
		const section = asRecord(entry, `About section ${index + 1}`);
		return {
			key: requireStableId(
				requiredText(section._key, `About section ${index + 1} key`),
				`About section ${index + 1} key`,
			),
			title: requiredText(section.title, `About section ${index + 1} title`),
			items: asArray(section.items, `About section ${index + 1} items`, 20).map(
				(item, itemIndex) =>
					requiredText(item, `About section ${index + 1} item ${itemIndex + 1}`),
			),
		};
	});
}

function aboutHighlights(value: unknown): NonNullable<AboutPageDraftPayload["highlights"]> {
	if (value === undefined || value === null) return [];
	return asArray(value, "About highlights", 12).map((entry, index) => {
		const highlight = asRecord(entry, `About highlight ${index + 1}`);
		return {
			key: requireStableId(
				requiredText(highlight._key, `About highlight ${index + 1} key`),
				`About highlight ${index + 1} key`,
			),
			label: requiredText(highlight.label, `About highlight ${index + 1} label`),
			value: requiredText(highlight.value, `About highlight ${index + 1} value`),
		};
	});
}

function plainPortableTextParagraphs(value: unknown) {
	const blocks = asArray(value, "Contact introduction", 20);
	const paragraphs = blocks.map((entry, blockIndex) => {
		const block = asRecord(entry, `Contact introduction block ${blockIndex + 1}`);
		if (
			block._type !== "block"
			|| (block.style !== undefined && block.style !== "normal")
			|| block.listItem !== undefined
			|| block.level !== undefined
			|| asArray(block.markDefs ?? [], "Contact introduction mark definitions", 0).length !== 0
		) {
			throw new Error("Contact introduction contains unsupported rich content");
		}
		const text = asArray(block.children, "Contact introduction spans", 100)
			.map((entry, spanIndex) => {
				const span = asRecord(entry, `Contact introduction span ${spanIndex + 1}`);
				if (
					span._type !== "span"
					|| asArray(span.marks ?? [], "Contact introduction span marks", 0).length !== 0
				) throw new Error("Contact introduction contains unsupported rich content");
				if (typeof span.text !== "string") {
					throw new Error(`Contact introduction span ${spanIndex + 1} must contain text`);
				}
				return span.text;
			})
			.join("")
			.replace(/\r\n?/g, "\n")
			.trim();
		if (!text) throw new Error("Contact introduction contains an empty paragraph");
		return text;
	});
	if (paragraphs.length === 0) throw new Error("Contact introduction is required");
	return paragraphs;
}

function resolvedStaticCopy(decision: SanityAboutContactOwnerDecisions["contactStaticCopy"]) {
	return decision.action === "accept-host-seed-owner-approved"
		? {
				action: decision.action,
				sourceSha256: ANGELS_REST_CONTACT_PARITY_SEED.sha256,
				confirmationMessage: ANGELS_REST_CONTACT_PARITY_SEED.confirmationMessage,
				bookingLabel: ANGELS_REST_CONTACT_PARITY_SEED.bookingLabel,
				bookingIntro: ANGELS_REST_CONTACT_PARITY_SEED.bookingIntro,
				inquiryChoices: [...ANGELS_REST_CONTACT_PARITY_SEED.inquiryChoices],
			}
		: {
				action: decision.action,
				sourceSha256: ANGELS_REST_CONTACT_PARITY_SEED.sha256,
				confirmationMessage: requiredText(
					decision.confirmationMessage,
					"Replacement confirmation message",
				),
				bookingLabel: requiredText(decision.bookingLabel, "Replacement booking label"),
				bookingIntro: requiredText(decision.bookingIntro, "Replacement booking introduction"),
				inquiryChoices: decision.inquiryChoices.map((choice, index) =>
					requiredText(choice, `Replacement inquiry choice ${index + 1}`),
				),
			};
}

function resolvedSourceOrFallback(
	value: unknown,
	label: string,
	decision: { action: "use-source-owner-approved" | "use-host-fallback-owner-approved" },
	fallback: string,
) {
	const sourceValue = optionalText(value, label);
	if (
		(sourceValue !== undefined && decision.action !== "use-source-owner-approved")
		|| (sourceValue === undefined && decision.action !== "use-host-fallback-owner-approved")
	) throw new Error(`${label} decision does not match the source`);
	return {
		action: decision.action,
		sourceValueCanonical: canonicalJson(sourceValue ?? null),
		value: sourceValue ?? fallback,
	};
}

function assertSourceOrFallbackDecision(
	decision: {
		action: "use-source-owner-approved" | "use-host-fallback-owner-approved";
		sourceValueCanonical: string;
		value: string;
	},
	fallback: string,
	label: string,
) {
	if (
		(decision.action === "use-host-fallback-owner-approved"
			&& (decision.sourceValueCanonical !== "null" || decision.value !== fallback))
		|| (decision.action === "use-source-owner-approved"
			&& decision.sourceValueCanonical !== canonicalJson(decision.value))
	) throw new Error(`${label} decision binding is invalid`);
}

function resolvedBooking(
	document: JsonRecord,
	decision: SanityAboutContactOwnerDecisions["contactBooking"],
) {
	if (document.bookingEnabled !== undefined && typeof document.bookingEnabled !== "boolean") {
		throw new Error("Contact booking enabled state must be boolean");
	}
	const sourceEnabled = document.bookingEnabled === true;
	const sourceUrl = optionalText(document.bookingUrl, "Contact booking URL");
	if (decision.action === "use-sanity-booking-owner-approved") {
		return {
			action: decision.action,
			sourceEnabled,
			...(sourceUrl === undefined ? {} : { sourceUrl }),
			enabled: sourceEnabled,
			...(sourceEnabled
				? { url: calBookingUrl(sourceUrl, "Contact booking URL") }
				: {}),
		};
	}
	if (decision.action === "use-host-seed-booking-owner-approved") {
		return {
			action: decision.action,
			sourceEnabled,
			...(sourceUrl === undefined ? {} : { sourceUrl }),
			enabled: ANGELS_REST_CONTACT_PARITY_SEED.bookingEnabled,
			url: ANGELS_REST_CONTACT_PARITY_SEED.bookingUrl,
		};
	}
	const url = optionalText(decision.url, "Replacement booking URL");
	if (!decision.enabled && url !== undefined) {
		throw new Error("Replacement booking URL must be absent when booking is disabled");
	}
	return {
		action: decision.action,
		sourceEnabled,
		...(sourceUrl === undefined ? {} : { sourceUrl }),
		enabled: decision.enabled,
		...(decision.enabled
			? { url: calBookingUrl(url, "Replacement booking URL") }
			: {}),
	};
}

/** Build one revision-pinned, fixed-pair plan without provider access or writes. */
export function createSanityAboutContactPlan(
	source: SanityAboutContactSource,
	options: SanityAboutContactBuildOptions,
): SanityAboutContactPlan {
	const about = singleton(source.about, "About");
	const contact = singleton(source.contact, "Contact");
	const aboutIdentity = sourceIdentity(about, "about");
	const contactIdentity = sourceIdentity(contact, "contactPage");
	const fullBio = about.fullBio;
	const plainBio = optionalText(about.plainBio, "About plain biography");
	const fullBioPresent =
		fullBio !== undefined
		&& fullBio !== null
		&& asArray(fullBio, "About full biography", 500).length > 0;
	if (
		fullBioPresent
		&& (!plainBio || options.decisions.aboutBiography.action !== "use-plain-bio-owner-approved")
	) {
		throw new Error("Nonempty About fullBio requires an approved plain equivalent");
	}
	if (
		(plainBio && options.decisions.aboutBiography.action !== "use-plain-bio-owner-approved")
		|| (!plainBio && options.decisions.aboutBiography.action !== "confirmed-absent-owner-approved")
	) throw new Error("About biography decision does not match the source");

	const sourceAssetRef = portraitAssetRef(about.portrait);
	const portraitInput = options.decisions.aboutPortrait;
	if (portraitInput.action === "use-sanity-portrait-owner-approved" && !sourceAssetRef) {
		throw new Error("The approved Sanity portrait is absent from the source");
	}
	const portrait = portraitInput.action === "use-local-portrait-owner-approved"
		? {
				action: portraitInput.action,
				...(sourceAssetRef === undefined ? {} : { sourceAssetRef }),
				localPath: ANGELS_REST_ABOUT_LOCAL_PORTRAIT.path,
				localSha256: ANGELS_REST_ABOUT_LOCAL_PORTRAIT.sha256,
				localWidth: ANGELS_REST_ABOUT_LOCAL_PORTRAIT.width,
				localHeight: ANGELS_REST_ABOUT_LOCAL_PORTRAIT.height,
				targetMediaAssetId: portraitInput.targetMediaAssetId,
				targetWorkerAssetId: requiredText(
					portraitInput.targetWorkerAssetId,
					"About portrait worker asset ID",
				),
				targetReceiptSha256: portraitInput.targetReceiptSha256,
				altText: requiredText(portraitInput.altText, "About portrait alt text"),
			}
		: {
				action: portraitInput.action,
				sourceAssetRef: sourceAssetRef as string,
				sourceSha256: portraitInput.sourceSha256,
				sourceWidth: sanityImageDimensions(sourceAssetRef as string).width,
				sourceHeight: sanityImageDimensions(sourceAssetRef as string).height,
				targetMediaAssetId: portraitInput.targetMediaAssetId,
				targetWorkerAssetId: requiredText(
					portraitInput.targetWorkerAssetId,
					"About portrait worker asset ID",
				),
				targetReceiptSha256: portraitInput.targetReceiptSha256,
				altText: requiredText(portraitInput.altText, "About portrait alt text"),
			};

	const introParagraphs = plainPortableTextParagraphs(contact.intro);
	const staticCopy = resolvedStaticCopy(options.decisions.contactStaticCopy);
	const booking = resolvedBooking(contact, options.decisions.contactBooking);
	const aboutSeo = about.seo === undefined || about.seo === null
		? {}
		: asRecord(about.seo, "About SEO");
	const heading = resolvedSourceOrFallback(
		about.heading,
		"About heading",
		options.decisions.aboutHeading,
		ANGELS_REST_ABOUT_PARITY_SEED.heading,
	);
	const seoDescription = resolvedSourceOrFallback(
		aboutSeo.description,
		"About SEO description",
		options.decisions.aboutSeoDescription,
		ANGELS_REST_ABOUT_PARITY_SEED.seoDescription,
	);
	const sourceSeoImageUrl = optionalText(aboutSeo.ogImageUrl, "About SEO image URL");
	const seoImage = options.decisions.aboutSeoImage.action
		=== "use-sanity-og-image-owner-approved"
		? {
				action: options.decisions.aboutSeoImage.action,
				sourceValueCanonical: canonicalJson(sourceSeoImageUrl ?? null),
				url: publicUrl(sourceSeoImageUrl, "About SEO image URL"),
			}
		: {
				action: options.decisions.aboutSeoImage.action,
				sourceValueCanonical: canonicalJson(sourceSeoImageUrl ?? null),
				fallbackPath: "/og-image.jpg" as const,
			};
	const aboutPayload: AboutPageDraftPayload = {
		heading: heading.value,
		displayName: requiredText(about.name, "About name"),
		...(optionalText(about.title, "About role") === undefined
			? {}
			: { role: optionalText(about.title, "About role") }),
		introduction: requiredText(about.shortBio, "About short biography"),
		...(plainBio === undefined ? {} : { biography: plainBio }),
		portraits: [
			{
				key: "primary-portrait",
				assetId: portrait.targetMediaAssetId,
				altText: portrait.altText,
			},
		],
		sections: aboutSections(about.sections),
		highlights: aboutHighlights(about.highlights),
		seoDescription: seoDescription.value,
		...(seoImage.action === "use-sanity-og-image-owner-approved"
			? { seoImageUrl: seoImage.url }
			: {}),
	};
	const contactPayload: ContactPageDraftPayload = {
		heading: requiredText(contact.heading, "Contact heading"),
		intro: introParagraphs.join("\n\n"),
		email: requiredText(contact.email, "Contact email"),
		...(optionalText(contact.phone, "Contact phone") === undefined
			? {}
			: { phone: optionalText(contact.phone, "Contact phone") }),
		confirmationMessage: staticCopy.confirmationMessage,
		bookingEnabled: booking.enabled,
		...(booking.url === undefined ? {} : { bookingUrl: booking.url }),
		bookingLabel: staticCopy.bookingLabel,
		bookingIntro: staticCopy.bookingIntro,
		inquiryChoices: staticCopy.inquiryChoices,
	};

	const plan: SanityAboutContactPlan = {
		version: 1,
		migrationId: options.migrationId,
		siteUrl: options.siteUrl,
		source: options.source,
		decisionSet: {
			id: options.decisions.id,
			aboutHeading: heading,
			aboutBiography: plainBio
				? {
						action: "use-plain-bio-owner-approved",
						sourcePlainBio: plainBio,
						sourceFullBioCanonical: canonicalJson(fullBio ?? null),
					}
				: {
						action: "confirmed-absent-owner-approved",
						sourceFullBioCanonical: canonicalJson(fullBio ?? null),
					},
			aboutPortrait: portrait,
			aboutSeoImage: seoImage,
			aboutSeoDescription: seoDescription,
			aboutSocial: {
				action: "defer-to-site-settings-owner-approved",
				sourceValueCanonical: canonicalJson(about.social ?? null),
			},
			contactIntro: {
				action: "accept-source-plain-paragraphs-owner-approved",
				sourceValueCanonical: canonicalJson(contact.intro),
				paragraphs: introParagraphs,
			},
			contactStaticCopy: staticCopy,
			contactBooking: booking,
			contactBookingTypes: {
				action: "omit-owner-approved",
				sourceValueCanonical: canonicalJson(contact.bookingTypes ?? []),
			},
		},
		entries: [
			{ kind: "aboutPage", ...aboutIdentity, payload: aboutPayload },
			{ kind: "contactPage", ...contactIdentity, payload: contactPayload },
		],
	};
	assertSanityAboutContactPlan(plan);
	return plan;
}

/** Runtime semantic validation; called before hashing and every mutation. */
export function assertSanityAboutContactPlan(plan: SanityAboutContactPlan) {
	if (plan.version !== 1 || plan.source.perspective !== "published") {
		throw new Error("About/Contact source identity is invalid");
	}
	for (const [value, label] of [
		[plan.migrationId, "Migration ID"],
		[plan.siteUrl, "Site URL"],
		[plan.source.projectId, "Sanity project ID"],
		[plan.source.dataset, "Sanity dataset"],
		[plan.decisionSet.id, "Decision set ID"],
	] as const) requireStableId(value, label);
	if (
		plan.entries.length !== 2
		|| plan.entries[0]?.kind !== "aboutPage"
		|| plan.entries[1]?.kind !== "contactPage"
	) throw new Error("About/Contact plan must contain the exact ordered pair");
	const about = plan.entries[0];
	const contact = plan.entries[1];
	if (about.sourceId === contact.sourceId) throw new Error("Source document IDs must be unique");
	for (const entry of plan.entries) {
		requireStableId(entry.sourceId, `${entry.kind} source ID`);
		requireRevision(entry.sourceRevision, `${entry.kind} source revision`);
	}
	toPublishedAboutPage(about.payload);
	toPublishedContactPage(contact.payload);
	requireAboutHostShape(about.payload);
	requireContactHostShape(contact.payload);
	requiredText(about.payload.introduction, "About introduction");
	assertSourceOrFallbackDecision(
		plan.decisionSet.aboutHeading,
		ANGELS_REST_ABOUT_PARITY_SEED.heading,
		"About heading",
	);
	assertSourceOrFallbackDecision(
		plan.decisionSet.aboutSeoDescription,
		ANGELS_REST_ABOUT_PARITY_SEED.seoDescription,
		"About SEO description",
	);
	if (about.payload.heading !== plan.decisionSet.aboutHeading.value) {
		throw new Error("About heading decision was not applied");
	}
	if (about.payload.seoDescription !== plan.decisionSet.aboutSeoDescription.value) {
		throw new Error("About SEO description decision was not applied");
	}
	if (
		about.payload.portraits?.length !== 1
		|| about.payload.portraits[0]?.key !== "primary-portrait"
		|| about.payload.portraits[0].assetId !== plan.decisionSet.aboutPortrait.targetMediaAssetId
		|| about.payload.portraits[0].altText !== plan.decisionSet.aboutPortrait.altText
	) throw new Error("About portrait decision was not applied");
	if (plan.decisionSet.aboutPortrait.action === "use-local-portrait-owner-approved") {
		const portrait = plan.decisionSet.aboutPortrait;
		if (
			portrait.localPath !== ANGELS_REST_ABOUT_LOCAL_PORTRAIT.path
			|| portrait.localSha256 !== ANGELS_REST_ABOUT_LOCAL_PORTRAIT.sha256
			|| portrait.localWidth !== ANGELS_REST_ABOUT_LOCAL_PORTRAIT.width
			|| portrait.localHeight !== ANGELS_REST_ABOUT_LOCAL_PORTRAIT.height
		) throw new Error("Local About portrait identity changed");
	} else if (
		!SANITY_IMAGE_REF_PATTERN.test(plan.decisionSet.aboutPortrait.sourceAssetRef)
		|| !SHA256_PATTERN.test(plan.decisionSet.aboutPortrait.sourceSha256)
		|| plan.decisionSet.aboutPortrait.sourceWidth
			!== sanityImageDimensions(plan.decisionSet.aboutPortrait.sourceAssetRef).width
		|| plan.decisionSet.aboutPortrait.sourceHeight
			!== sanityImageDimensions(plan.decisionSet.aboutPortrait.sourceAssetRef).height
	) {
		throw new Error("Sanity About portrait identity is invalid");
	}
	if (!SHA256_PATTERN.test(plan.decisionSet.aboutPortrait.targetReceiptSha256)) {
		throw new Error("About portrait receipt digest is invalid");
	}
	if (!WORKER_ASSET_ID_PATTERN.test(plan.decisionSet.aboutPortrait.targetWorkerAssetId)) {
		throw new Error("About portrait worker asset ID is invalid");
	}
	const seoImage = plan.decisionSet.aboutSeoImage;
	if (
		(seoImage.action === "use-sanity-og-image-owner-approved"
			&& about.payload.seoImageUrl !== publicUrl(seoImage.url, "About SEO image URL"))
		|| (seoImage.action === "keep-host-fallback-owner-approved"
			&& (about.payload.seoImageUrl !== undefined || seoImage.fallbackPath !== "/og-image.jpg"))
	) throw new Error("About SEO image decision was not applied");
	const biography = plan.decisionSet.aboutBiography;
	if (
		(biography.action === "use-plain-bio-owner-approved"
			&& about.payload.biography !== biography.sourcePlainBio)
		|| (biography.action === "confirmed-absent-owner-approved"
			&& (
				about.payload.biography !== undefined
				|| (biography.sourceFullBioCanonical !== "null"
					&& biography.sourceFullBioCanonical !== "[]")
			))
	) throw new Error("About biography decision was not applied");
	if (contact.payload.intro !== plan.decisionSet.contactIntro.paragraphs.join("\n\n")) {
		throw new Error("Contact introduction decision was not applied");
	}
	const staticCopy = plan.decisionSet.contactStaticCopy;
	if (
		staticCopy.sourceSha256 !== ANGELS_REST_CONTACT_PARITY_SEED.sha256
		|| contact.payload.confirmationMessage !== staticCopy.confirmationMessage
		|| contact.payload.bookingLabel !== staticCopy.bookingLabel
		|| contact.payload.bookingIntro !== staticCopy.bookingIntro
		|| canonicalJson(contact.payload.inquiryChoices ?? []) !== canonicalJson(staticCopy.inquiryChoices)
	) throw new Error("Contact static-copy decision was not applied");
	if (
		staticCopy.action === "accept-host-seed-owner-approved"
		&& (
			staticCopy.confirmationMessage !== ANGELS_REST_CONTACT_PARITY_SEED.confirmationMessage
			|| staticCopy.bookingLabel !== ANGELS_REST_CONTACT_PARITY_SEED.bookingLabel
			|| staticCopy.bookingIntro !== ANGELS_REST_CONTACT_PARITY_SEED.bookingIntro
			|| canonicalJson(staticCopy.inquiryChoices)
				!== canonicalJson(ANGELS_REST_CONTACT_PARITY_SEED.inquiryChoices)
		)
	) throw new Error("Accepted Contact seed copy changed");
	const booking = plan.decisionSet.contactBooking;
	if (
		contact.payload.bookingEnabled !== booking.enabled
		|| contact.payload.bookingUrl !== booking.url
	) throw new Error("Contact booking decision was not applied");
	if (
		(booking.action === "use-sanity-booking-owner-approved"
			&& (booking.enabled !== booking.sourceEnabled || booking.url !== booking.sourceUrl))
		|| (booking.action === "use-host-seed-booking-owner-approved"
			&& (
				booking.enabled !== ANGELS_REST_CONTACT_PARITY_SEED.bookingEnabled
				|| booking.url !== ANGELS_REST_CONTACT_PARITY_SEED.bookingUrl
			))
	) throw new Error("Accepted Contact booking source changed");
	if (contact.payload.availability !== undefined || contact.payload.responseTime !== undefined) {
		throw new Error("Operational Contact fields are outside the source plan");
	}
}

export function canonicalSanityAboutContactPlan(plan: SanityAboutContactPlan) {
	assertSanityAboutContactPlan(plan);
	return `sanity-about-contact-plan:v1:${canonicalJson(plan)}`;
}

export async function digestSanityAboutContactPlan(plan: SanityAboutContactPlan) {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(canonicalSanityAboutContactPlan(plan)),
	);
	return Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
}

export async function requireSanityAboutContactPlan(
	plan: SanityAboutContactPlan,
	claimedDigest: string,
) {
	if (!SHA256_PATTERN.test(claimedDigest)) throw new Error("Plan digest is invalid");
	const actualDigest = await digestSanityAboutContactPlan(plan);
	if (actualDigest !== claimedDigest) throw new Error("Plan digest does not match canonical bytes");
	return actualDigest;
}
