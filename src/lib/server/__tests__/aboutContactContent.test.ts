import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("$env/dynamic/private", () => ({ env: {} }));
vi.mock("$env/dynamic/public", () => ({
	env: { PUBLIC_CONVEX_URL: "https://convex.test" },
}));
vi.mock("$lib/sanity/client.server", () => ({ getSanityClient: vi.fn() }));
vi.mock("$lib/server/logger", () => ({ logStructured: vi.fn() }));

import {
	adaptConvexAboutContact,
	adaptSanityAboutContact,
	compareAboutContact,
	createAboutContactContentProvider,
	parseAboutContactProviderMode,
} from "$lib/server/aboutContactContent.server";

const CONTACT_INTRO =
	"I'd love to hear from you. Whether you're looking to book a photo session, pick up some prints, or want to chat about a web project, drop me a line below. I build custom websites for photographers and creatives, so if you're looking for something like that too, let's talk. I'll get back to you as soon as I can.";

function sanityProjection() {
	return {
		about: [
			{
				name: "Jesse Pomeroy",
				shortBio: "Photographer, visual artist, and web developer.",
				social: null,
				seo: { description: "About Jesse Pomeroy", ogImageUrl: null },
			},
		],
		contact: [
			{
				heading: "Get in Touch",
				intro: [
					{
						_key: "intro-1",
						_type: "block",
						style: "normal",
						listItem: null,
						level: null,
						children: [{ _key: "span-1", _type: "span", text: CONTACT_INTRO, marks: [] }],
						markDefs: [],
					},
				],
				email: "hello@angelsrest.online",
				phone: null,
				bookingEnabled: true,
			},
		],
	};
}

function derivatives() {
	return Object.fromEntries(
		["thumb", "card", "display1280", "display2048", "display2560"].map((name) => [
			name,
			{
				key: `sites/angelsrest.online/web/123e4567-e89b-42d3-a456-426614174000/${name}.webp`,
				contentType: "image/webp",
				width: 320,
				height: 480,
			},
		]),
	);
}

function convexProjection() {
	return {
		about: {
			revisionId: "about-revision",
			publishedAt: 1,
			payload: {
				heading: "About",
				displayName: "Jesse Pomeroy",
				introduction: "Photographer, visual artist, and web developer.",
				portraits: [
					{
						key: "portrait",
						order: 0,
						altText: "Jesse Pomeroy",
						asset: {
							assetId: "123e4567-e89b-42d3-a456-426614174000",
							source: {
								width: 1440,
								height: 2160,
								sha256: "0e94b665f7654c74158daf3aa2c497139c5cb7c4490d72205cfa3babd6dc4eb0",
							},
							derivatives: derivatives(),
						},
					},
				],
				sections: [],
				highlights: [],
				seoDescription: "About Jesse Pomeroy",
			},
		},
		contact: {
			revisionId: "contact-revision",
			publishedAt: 1,
			payload: {
				heading: "Get in Touch",
				intro: CONTACT_INTRO,
				email: "hello@angelsrest.online",
				confirmationMessage: "message sent !",
				booking: {
					enabled: true,
					url: "https://cal.com/jesse-s1wmio/photosession",
					label: "book a time",
					intro: "want to book a session or schedule a call?",
				},
				inquiryChoices: [],
			},
		},
	};
}

function fakeSanity(value = adaptSanityAboutContact(sanityProjection())) {
	return { load: vi.fn(async () => value) };
}

afterEach(() => {
	vi.useRealTimers();
});

describe("About and Contact provider boundary", () => {
	it("normalizes both complete providers and rejects duplicate or rich Sanity content", () => {
		const sanity = adaptSanityAboutContact(sanityProjection());
		const convex = adaptConvexAboutContact(convexProjection());
		expect(convex.contact).toEqual(sanity.contact);
		expect({ ...convex.about, portrait: sanity.about.portrait }).toEqual(sanity.about);
		expect(convex.about.portrait).toEqual({
			src: "https://media.angelsrest.online/sites/angelsrest.online/web/123e4567-e89b-42d3-a456-426614174000/display-1280.webp",
			altText: "Jesse Pomeroy",
			sourceSha256: "0e94b665f7654c74158daf3aa2c497139c5cb7c4490d72205cfa3babd6dc4eb0",
		});
		expect(compareAboutContact(sanity, convex)).toMatchObject({ codes: [] });

		const duplicate = sanityProjection();
		duplicate.about.push(structuredClone(duplicate.about[0]));
		expect(() => adaptSanityAboutContact(duplicate)).toThrow(
			"Malformed public About and Contact projection",
		);

		const marked = sanityProjection();
		(marked.contact[0].intro[0].children[0].marks as string[]).push("strong");
		expect(() => adaptSanityAboutContact(marked)).toThrow(
			"Malformed public About and Contact projection",
		);
	});

	it("routes preview to Sanity first and never partially falls back from Convex", async () => {
		expect(parseAboutContactProviderMode(undefined)).toBe("sanity");
		expect(parseAboutContactProviderMode(" convex ")).toBe("sanity");

		const sanity = fakeSanity();
		const mode = vi.fn(() => "convex");
		const createReader = vi.fn(() => ({ loadPublished: vi.fn() }));
		const provider = createAboutContactContentProvider({ sanity, mode, createReader });
		await provider.load(true);
		expect(sanity.load).toHaveBeenCalledWith(true);
		expect(mode).not.toHaveBeenCalled();
		expect(createReader).not.toHaveBeenCalled();

		const missing = createAboutContactContentProvider({
			sanity,
			mode: () => "convex",
			createReader: () => ({
				loadPublished: vi.fn(async () => ({ ...convexProjection(), contact: null })),
			}),
		});
		await expect(missing.load(false)).rejects.toMatchObject({ status: 503 });
		expect(sanity.load).toHaveBeenCalledTimes(1);
	});

	it("serves exact Sanity content in shadow and logs only bounded mismatch metadata", async () => {
		const primary = adaptSanityAboutContact(sanityProjection());
		const changed = convexProjection();
		changed.about.payload.displayName = "Private changed name";
		const log = vi.fn();
		const provider = createAboutContactContentProvider({
			sanity: fakeSanity(primary),
			mode: () => "shadow",
			createReader: () => ({ loadPublished: vi.fn(async () => changed) }),
			log,
		});

		await expect(provider.load(false)).resolves.toBe(primary);
		expect(compareAboutContact(primary, adaptConvexAboutContact(changed))).toMatchObject({
			codes: ["about"],
			mismatchCount: 1,
		});
		expect(log).toHaveBeenCalledOnce();
		expect(log.mock.calls[0]?.[0]).toMatchObject({
			event: "about_contact.shadow_closed",
			meta: { codes: ["about"], mismatchCount: 1, primaryCount: 2, secondaryCount: 2 },
		});
		expect(JSON.stringify(log.mock.calls[0]?.[0])).not.toMatch(
			/Private changed name|hello@angelsrest\.online|photosession/,
		);
	});

	it("bounds a stalled shadow read without delaying the Sanity response indefinitely", async () => {
		vi.useFakeTimers();
		const log = vi.fn();
		const provider = createAboutContactContentProvider({
			sanity: fakeSanity(),
			mode: () => "shadow",
			createReader: () => ({ loadPublished: () => new Promise(() => {}) }),
			log,
			deadlineMs: 5,
		});

		const result = provider.load(false);
		await vi.advanceTimersByTimeAsync(5);
		await expect(result).resolves.toEqual(adaptSanityAboutContact(sanityProjection()));
		expect(log.mock.calls[0]?.[0]).toMatchObject({
			meta: { codes: ["timeout"], mismatchCount: 1 },
		});
	});
});
