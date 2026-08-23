import { error } from "@sveltejs/kit";
import { ConvexHttpClient } from "convex/browser";
import { api } from "$convex/api";
import { env as privateEnv } from "$env/dynamic/private";
import { env as publicEnv } from "$env/dynamic/public";
import {
	ABOUT_CONTACT_SEO_DESCRIPTION_FALLBACK,
	type AboutContactContent,
} from "$lib/about-contact/content";
import localPortrait from "$lib/assets/DSCF7533.jpg";
import { SITE_DOMAIN, SITE_URL } from "$lib/config/site";
import { contactPageSeed } from "$lib/content/contactPageSeed";
import { getSanityClient } from "$lib/sanity/client.server";
import { logStructured } from "$lib/server/logger";

const SHADOW_DEADLINE_MS = 750;
const MEDIA_ROOT = `https://media.angelsrest.online/sites/${SITE_DOMAIN}/web`;
const LOCAL_PORTRAIT_SHA256 = "0e94b665f7654c74158daf3aa2c497139c5cb7c4490d72205cfa3babd6dc4eb0";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type ProviderMode = "sanity" | "shadow" | "convex";
type ShadowCode = "about" | "contact" | "normalization_error" | "secondary_error" | "timeout";
type Comparison = {
	codes: ShadowCode[];
	mismatchCount: number;
	primaryCount: number | null;
	secondaryCount: number | null;
};
type SanityClient = Pick<ReturnType<typeof getSanityClient>, "fetch">;
type SanitySource = {
	load(isPreview: boolean): Promise<AboutContactContent>;
};
type ConvexReader = {
	loadPublished(signal: AbortSignal): Promise<unknown>;
};

const SANITY_QUERY = `{
	"about": *[_type == "about"][0...2]{
		name,
		shortBio,
		seo{
			description,
			"ogImageUrl": ogImage.asset->url
		}
	},
	"contact": *[_type == "contactPage"][0...2]{
		heading,
		intro[]{
			_key,
			_type,
			style,
			listItem,
			level,
			children[]{_key, _type, text, marks},
			markDefs[]{_key, _type, href}
		},
		email,
		phone,
		bookingEnabled
	}
}`;

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

function rawText(value: unknown, maximum: number): string {
	if (typeof value !== "string" || value.length > maximum) fail();
	return value;
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

function sanityParagraphs(value: unknown): string[] {
	const blocks = list(value, 20);
	if (blocks.length === 0) fail();
	const blockKeys = new Set<string>();
	return blocks.map((rawBlock) => {
		const block = object(rawBlock, [
			"_key",
			"_type",
			"style",
			"listItem",
			"level",
			"children",
			"markDefs",
		]);
		const blockKey = requiredText(block._key, 100);
		if (blockKeys.has(blockKey)) fail();
		blockKeys.add(blockKey);
		if (
			block._type !== "block" ||
			block.style !== "normal" ||
			block.listItem !== null ||
			block.level !== null ||
			list(block.markDefs, 20).length !== 0
		)
			fail();
		const children = list(block.children, 200);
		if (children.length === 0) fail();
		const childKeys = new Set<string>();
		const paragraph = children
			.map((rawChild) => {
				const child = object(rawChild, ["_key", "_type", "text", "marks"]);
				const childKey = requiredText(child._key, 100);
				if (childKeys.has(childKey)) fail();
				childKeys.add(childKey);
				if (child._type !== "span" || list(child.marks, 10).length !== 0) fail();
				return rawText(child.text, 10_000);
			})
			.join("")
			.trim();
		if (!paragraph || paragraph.length > 2_000) fail();
		return paragraph;
	});
}

function seedContact(enabled: boolean) {
	const booking = enabled ? calBooking(contactPageSeed.bookingUrl) : { url: null, calLink: null };
	const choices = list(contactPageSeed.inquiryChoices ?? [], 12).map((choice) =>
		requiredText(choice, 120),
	);
	if (new Set(choices.map((choice) => choice.toLocaleLowerCase())).size !== choices.length) fail();
	return {
		confirmationMessage: requiredText(contactPageSeed.confirmationMessage, 500),
		booking: {
			enabled,
			...booking,
			label: requiredText(contactPageSeed.bookingLabel, 120),
			intro: requiredText(contactPageSeed.bookingIntro, 1_000),
		},
		inquiryChoices: choices,
	};
}

export function adaptSanityAboutContact(value: unknown): AboutContactContent {
	const root = object(value, ["about", "contact"]);
	const aboutRows = list(root.about, 2);
	const contactRows = list(root.contact, 2);
	if (aboutRows.length !== 1 || contactRows.length !== 1) fail();

	const about = object(aboutRows[0], ["name", "shortBio", "seo"]);
	const seo = about.seo === null ? null : object(about.seo, ["description", "ogImageUrl"]);

	const contact = object(contactRows[0], ["heading", "intro", "email", "phone", "bookingEnabled"]);
	if (contact.bookingEnabled !== null && typeof contact.bookingEnabled !== "boolean") fail();
	const seed = seedContact(contact.bookingEnabled === true);

	const displayName = requiredText(about.name, 200);
	return {
		siteUrl: SITE_URL,
		about: {
			displayName,
			introduction: requiredText(about.shortBio, 2_000),
			portrait: {
				src: localPortrait,
				altText: displayName,
				sourceSha256: LOCAL_PORTRAIT_SHA256,
			},
			seo: {
				description: seo ? optionalText(seo.description, 320) : null,
				imageUrl: seo ? optionalUrl(seo.ogImageUrl) : null,
			},
		},
		contact: {
			heading: requiredText(contact.heading, 120),
			intro: sanityParagraphs(contact.intro),
			email: email(contact.email),
			phone: optionalText(contact.phone, 80),
			...seed,
		},
	};
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
	let link: { url: string | null; calLink: string | null } = { url: null, calLink: null };
	if (booking.enabled) link = calBooking(booking.url);
	else if (booking.url !== undefined) fail();
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

function same(left: unknown, right: unknown) {
	return JSON.stringify(left) === JSON.stringify(right);
}

function aboutSemantics(value: AboutContactContent["about"]) {
	return {
		...value,
		seo: {
			...value.seo,
			description: value.seo.description ?? ABOUT_CONTACT_SEO_DESCRIPTION_FALLBACK,
		},
		portrait: {
			altText: value.portrait.altText,
			sourceSha256: value.portrait.sourceSha256,
		},
	};
}

export function compareAboutContact(
	primary: AboutContactContent,
	secondary: AboutContactContent,
): Comparison {
	const codes: ShadowCode[] = [];
	if (!same(aboutSemantics(primary.about), aboutSemantics(secondary.about))) codes.push("about");
	if (!same(primary.contact, secondary.contact)) codes.push("contact");
	return {
		codes,
		mismatchCount: codes.length,
		primaryCount: 2,
		secondaryCount: 2,
	};
}

export function parseAboutContactProviderMode(value: unknown): ProviderMode {
	return value === "sanity" || value === "shadow" || value === "convex" ? value : "sanity";
}

export function createSanityAboutContactSource(
	selectClient: (isPreview: boolean) => SanityClient = getSanityClient,
): SanitySource {
	return {
		async load(isPreview) {
			return adaptSanityAboutContact(await selectClient(isPreview).fetch(SANITY_QUERY));
		},
	};
}

function createConvexReader(): ConvexReader {
	return {
		async loadPublished(signal) {
			const client = new ConvexHttpClient(publicEnv.PUBLIC_CONVEX_URL || "", {
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
	dependencies: {
		sanity?: SanitySource;
		mode?: () => unknown;
		createReader?: () => ConvexReader;
		log?: typeof logStructured;
		now?: () => number;
		deadlineMs?: number;
	} = {},
) {
	const sanity = dependencies.sanity ?? createSanityAboutContactSource();
	const mode = dependencies.mode ?? (() => privateEnv.ABOUT_CONTACT_CONTENT_PROVIDER);
	const createReader = dependencies.createReader ?? createConvexReader;
	const log = dependencies.log ?? logStructured;
	const now = dependencies.now ?? Date.now;
	const deadlineMs = dependencies.deadlineMs ?? SHADOW_DEADLINE_MS;

	function report(comparison: Comparison, startedAt: number) {
		if (comparison.codes.length === 0) return;
		log({
			event: "about_contact.shadow_closed",
			level: "warn",
			durationMs: Math.max(0, Math.min(deadlineMs, Math.round(now() - startedAt))),
			meta: {
				codes: comparison.codes,
				mismatchCount: comparison.mismatchCount,
				primaryCount: comparison.primaryCount,
				secondaryCount: comparison.secondaryCount,
			},
		});
	}

	function bounded(work: Promise<Comparison>, controller: AbortController) {
		let timer: ReturnType<typeof setTimeout> | undefined;
		return Promise.race([
			work,
			new Promise<Comparison>((resolve) => {
				timer = setTimeout(() => {
					controller.abort();
					resolve({
						codes: ["timeout"],
						mismatchCount: 1,
						primaryCount: null,
						secondaryCount: null,
					});
				}, deadlineMs);
			}),
		]).finally(() => clearTimeout(timer));
	}

	async function loadConvex() {
		try {
			return adaptConvexAboutContact(
				await createReader().loadPublished(new AbortController().signal),
			);
		} catch {
			unavailable();
		}
	}

	async function loadShadow() {
		const startedAt = now();
		const controller = new AbortController();
		const primary = sanity.load(false);
		const comparison = bounded(
			(async () => {
				try {
					const [left, rawRight] = await Promise.all([
						primary,
						createReader().loadPublished(controller.signal),
					]);
					return compareAboutContact(left, adaptConvexAboutContact(rawRight));
				} catch (cause) {
					return {
						codes: [
							cause instanceof AboutContactProjectionError
								? "normalization_error"
								: "secondary_error",
						] as ShadowCode[],
						mismatchCount: 1,
						primaryCount: null,
						secondaryCount: null,
					};
				}
			})(),
			controller,
		);
		try {
			const result = await primary;
			report(await comparison, startedAt);
			return result;
		} catch (cause) {
			controller.abort();
			throw cause;
		}
	}

	return {
		async load(isPreview: boolean) {
			if (isPreview) return await sanity.load(true);
			const provider = parseAboutContactProviderMode(mode());
			if (provider === "convex") return await loadConvex();
			if (provider === "shadow") return await loadShadow();
			return await sanity.load(false);
		},
	};
}

export const aboutContactContent = createAboutContactContentProvider();
