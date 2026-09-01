import { describe, expect, it, vi } from "vitest";

vi.mock("$env/dynamic/private", () => ({ env: {} }));
vi.mock("$env/dynamic/public", () => ({
	env: { PUBLIC_CONVEX_URL: "https://convex.test" },
}));
vi.mock("$lib/sanity/client.server", () => ({ getSanityClient: vi.fn() }));

import {
	adaptConvexAboutContact,
	adaptSanityAboutContact,
	createAboutContactContentProvider,
	parseAboutContactProviderMode,
	projectSiteSettingsInstagramUrl,
} from "$lib/server/aboutContactContent.server";

const CONTACT_INTRO =
	"I'd love to hear from you. Whether you're looking to book a photo session, pick up some prints, or want to chat about a web project, drop me a line below. I build custom websites for photographers and creatives, so if you're looking for something like that too, let's talk. I'll get back to you as soon as I can.";

function sanityProjection() {
	return {
		about: [
			{
				name: "Jesse Pomeroy",
				shortBio: "Photographer, visual artist, and web developer.",
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
		expect(parseAboutContactProviderMode(undefined)).toBe("convex");
		expect(parseAboutContactProviderMode("sanity")).toBe("sanity");
		expect(parseAboutContactProviderMode("convex")).toBe("convex");
		expect(parseAboutContactProviderMode("shadow")).toBe("convex");
		expect(parseAboutContactProviderMode(" convex ")).toBe("convex");

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

	it("uses Convex for published reads when provider configuration is absent", async () => {
		const sanity = fakeSanity();
		const loadPublished = vi.fn(async () => convexProjection());
		const provider = createAboutContactContentProvider({
			sanity,
			createReader: () => ({ loadPublished }),
		});

		await expect(provider.load(false)).resolves.toEqual(
			adaptConvexAboutContact(convexProjection()),
		);
		expect(loadPublished).toHaveBeenCalledWith(expect.any(AbortSignal));
		expect(sanity.load).not.toHaveBeenCalled();
	});

	it("retains an explicit published Sanity rollback adapter", async () => {
		const sanity = fakeSanity();
		const provider = createAboutContactContentProvider({
			sanity,
			mode: () => "sanity",
			createReader: vi.fn(),
		});

		await provider.load(false);
		expect(sanity.load).toHaveBeenCalledWith(false);
	});

	it("projects the unique Instagram link from Site Settings", () => {
		expect(
			projectSiteSettingsInstagramUrl({
				socialLinks: [{ platform: "instagram", url: "https://www.instagram.com/stray_black_dog" }],
			}),
		).toBe("https://www.instagram.com/stray_black_dog");
		expect(projectSiteSettingsInstagramUrl({ socialLinks: [] })).toBeNull();
		expect(() =>
			projectSiteSettingsInstagramUrl({
				socialLinks: [
					{ platform: "instagram", url: "https://instagram.com/one" },
					{ platform: "instagram", url: "https://instagram.com/two" },
				],
			}),
		).toThrow("Malformed public About and Contact projection");
	});
});
