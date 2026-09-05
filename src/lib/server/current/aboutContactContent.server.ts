import { error } from "@sveltejs/kit";
import { ConvexHttpClient } from "convex/browser";
import { api } from "$convex/api";
import type { AboutContactContent } from "$lib/about-contact/content";
import { SITE_DOMAIN, SITE_URL } from "$lib/config/site";
import { getConvexUrl } from "$lib/server/runtimeConfig";

const MEDIA_ROOT = `https://media.angelsrest.online/sites/${SITE_DOMAIN}/web`;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type ConvexReader = {
	loadPublished(signal: AbortSignal): Promise<unknown>;
};

export class AboutContactProjectionError extends Error {
	constructor() {
		super("Malformed public About and Contact projection");
	}
}

function fail(): never {
	throw new AboutContactProjectionError();
}

function object(
	value: unknown,
	required: readonly string[],
	optional: readonly string[] = [],
): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) fail();
	if (Object.getPrototypeOf(value) !== Object.prototype) fail();
	const keys = Reflect.ownKeys(value);
	if (keys.some((key) => typeof key !== "string")) fail();
	const allowed = new Set([...required, ...optional]);
	if (
		required.some((key) => !Object.hasOwn(value, key)) ||
		keys.some((key) => !allowed.has(key as string))
	)
		fail();
	return value as Record<string, unknown>;
}

function list(value: unknown, maximum: number): unknown[] {
	if (!Array.isArray(value) || value.length > maximum) fail();
	return value;
}

function requiredText(value: unknown, maximum: number, pattern?: RegExp): string {
	if (typeof value !== "string") fail();
	const normalized = value.trim();
	if (!normalized || normalized.length > maximum || (pattern && !pattern.test(normalized))) fail();
	return normalized;
}

function optionalText(value: unknown, maximum: number): string | null {
	if (value === null || value === undefined) return null;
	if (typeof value !== "string") fail();
	const normalized = value.trim();
	if (!normalized) return null;
	if (normalized.length > maximum) fail();
	return normalized;
}

function integer(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
	if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum)
		fail();
	return value as number;
}

function publicUrl(value: unknown): string {
	const normalized = requiredText(value, 2_048);
	let parsed: URL;
	try {
		parsed = new URL(normalized);
	} catch {
		return fail();
	}
	if (
		(parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
		parsed.username ||
		parsed.password
	)
		fail();
	return normalized;
}

function optionalUrl(value: unknown): string | null {
	return value === null || value === undefined ? null : publicUrl(value);
}

function email(value: unknown): string {
	const normalized = requiredText(value, 254);
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) fail();
	return normalized;
}

function calBooking(value: unknown) {
	const url = publicUrl(value);
	const parsed = new URL(url);
	if (
		parsed.protocol !== "https:" ||
		(parsed.hostname !== "cal.com" && parsed.hostname !== "www.cal.com") ||
		parsed.search ||
		parsed.hash
	)
		fail();
	const calLink = parsed.pathname.replace(/^\/+|\/+$/g, "");
	if (!calLink || !/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)+$/.test(calLink)) fail();
	return { url, calLink };
}

function plainParagraphs(value: unknown): string[] {
	const normalized = requiredText(value, 2_000).replace(/\r\n?/g, "\n");
	const paragraphs = normalized.split(/\n\s*\n/).map((paragraph) => paragraph.trim());
	if (paragraphs.length > 20 || paragraphs.some((paragraph) => !paragraph)) fail();
	return paragraphs;
}

function derivative(value: unknown) {
	const item = object(value, ["key", "contentType", "width", "height"]);
	requiredText(item.key, 500);
	if (item.contentType !== "image/webp") fail();
	integer(item.width, 1, 100_000);
	integer(item.height, 1, 100_000);
}

function aboutPortraits(value: unknown) {
	const portraits = list(value, 10);
	if (portraits.length !== 1) fail();
	const keys = new Set<string>();
	return portraits.map((raw, index) => {
		const portrait = object(raw, ["key", "order", "altText", "asset"]);
		const key = requiredText(portrait.key, 100);
		if (keys.has(key) || integer(portrait.order, 0, 9) !== index) fail();
		keys.add(key);
		const altText = requiredText(portrait.altText, 500);
		const asset = object(portrait.asset, ["assetId", "source", "derivatives"]);
		const assetId = requiredText(asset.assetId, 36, UUID_V4);
		const source = object(asset.source, ["width", "height"], ["sha256"]);
		integer(source.width, 1, 100_000);
		integer(source.height, 1, 100_000);
		const sourceSha256 =
			source.sha256 === undefined ? null : requiredText(source.sha256, 64, /^[a-f0-9]{64}$/);
		const derivatives = object(asset.derivatives, [
			"thumb",
			"card",
			"display1280",
			"display2048",
			"display2560",
		]);
		for (const name of ["thumb", "card", "display1280", "display2048", "display2560"])
			derivative(derivatives[name]);
		return {
			src: `${MEDIA_ROOT}/${assetId}/display-1280.webp`,
			altText,
			sourceSha256,
		};
	});
}

function aboutSections(value: unknown) {
	const keys = new Set<string>();
	for (const raw of list(value, 12)) {
		const section = object(raw, ["key", "title", "items"]);
		const key = requiredText(section.key, 100);
		if (keys.has(key)) fail();
		keys.add(key);
		requiredText(section.title, 120);
		for (const item of list(section.items, 20)) requiredText(item, 500);
	}
}

function aboutHighlights(value: unknown) {
	const keys = new Set<string>();
	for (const raw of list(value, 12)) {
		const highlight = object(raw, ["key", "label", "value"]);
		const key = requiredText(highlight.key, 100);
		if (keys.has(key)) fail();
		keys.add(key);
		requiredText(highlight.label, 80);
		requiredText(highlight.value, 300);
	}
}

function publishedState(value: unknown) {
	const state = object(value, ["revisionId", "publishedAt", "payload"]);
	requiredText(state.revisionId, 100);
	integer(state.publishedAt);
	return state.payload;
}

export function adaptConvexAboutContact(value: unknown): AboutContactContent {
	const root = object(value, ["about", "contact"]);
	if (root.about === null || root.contact === null) fail();

	const about = object(
		publishedState(root.about),
		["heading", "displayName", "portraits", "sections", "highlights", "seoDescription"],
		["role", "introduction", "biography", "seoImageUrl"],
	);
	requiredText(about.heading, 120);
	optionalText(about.role, 160);
	const introduction = requiredText(about.introduction, 2_000);
	optionalText(about.biography, 8_000);
	const portraits = aboutPortraits(about.portraits);
	aboutSections(about.sections);
	aboutHighlights(about.highlights);

	const contact = object(
		publishedState(root.contact),
		["heading", "intro", "email", "confirmationMessage", "booking", "inquiryChoices"],
		["phone", "availability", "responseTime"],
	);
	optionalText(contact.availability, 500);
	optionalText(contact.responseTime, 300);
	const booking = object(contact.booking, ["enabled", "label", "intro"], ["url"]);
	if (typeof booking.enabled !== "boolean") fail();
	const link = booking.enabled
		? calBooking(booking.url)
		: booking.url !== undefined
			? fail()
			: { url: null, calLink: null };
	const choices = list(contact.inquiryChoices, 12).map((choice) => requiredText(choice, 120));
	if (new Set(choices.map((choice) => choice.toLocaleLowerCase())).size !== choices.length) fail();

	return {
		siteUrl: SITE_URL,
		about: {
			displayName: requiredText(about.displayName, 200),
			introduction,
			portrait: portraits[0] as AboutContactContent["about"]["portrait"],
			seo: {
				description: optionalText(about.seoDescription, 320),
				imageUrl: optionalUrl(about.seoImageUrl),
			},
		},
		contact: {
			heading: requiredText(contact.heading, 120),
			intro: plainParagraphs(contact.intro),
			email: email(contact.email),
			phone: optionalText(contact.phone, 80),
			confirmationMessage: requiredText(contact.confirmationMessage, 500),
			booking: {
				enabled: booking.enabled,
				...link,
				label: requiredText(booking.label, 120),
				intro: requiredText(booking.intro, 1_000),
			},
			inquiryChoices: choices,
		},
	};
}

/** Project the About social link from the separately owned Site Settings module. */
export function projectSiteSettingsInstagramUrl(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	if (!value || typeof value !== "object" || Array.isArray(value)) fail();
	const links = (value as Record<string, unknown>).socialLinks;
	if (links === null || links === undefined) return null;
	const matches = list(links, 20).filter((entry) => {
		const link = object(entry, ["platform", "url"]);
		return link.platform === "instagram";
	});
	if (matches.length > 1) fail();
	if (matches.length === 0) return null;
	return publicUrl((matches[0] as Record<string, unknown>).url);
}

function createConvexReader(): ConvexReader {
	return {
		async loadPublished(signal) {
			const client = new ConvexHttpClient(getConvexUrl(), {
				logger: false,
				fetch: (input, init) => fetch(input, { ...init, signal }),
			});
			return await client.query(api.content.getPublishedAboutContactWithRevisions, {
				siteUrl: SITE_DOMAIN,
			});
		},
	};
}

function unavailable(): never {
	throw error(503, "About and Contact are unavailable");
}

export function createAboutContactContentProvider(
	dependencies: { createReader?: () => ConvexReader } = {},
) {
	const createReader = dependencies.createReader ?? createConvexReader;

	async function loadConvex() {
		try {
			return adaptConvexAboutContact(
				await createReader().loadPublished(AbortSignal.timeout(6_000)),
			);
		} catch {
			unavailable();
		}
	}

	return {
		async load() {
			return await loadConvex();
		},
	};
}

export const aboutContactContent = createAboutContactContentProvider();
