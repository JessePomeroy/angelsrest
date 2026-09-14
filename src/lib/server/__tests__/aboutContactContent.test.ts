import { describe, expect, it, vi } from "vitest";
import { SITE_URL } from "$lib/config/site";
import {
	createAboutContactContentProvider,
	projectSiteSettingsInstagramUrl,
} from "$lib/server/current/aboutContactContent.server";
import { assetRoot, sourceSha256, webAsset } from "./fixtures/publicContent";

function publishedContent() {
	const asset = webAsset();
	return {
		about: {
			revisionId: "about-revision",
			publishedAt: 1000,
			payload: {
				heading: "About",
				displayName: "Jesse",
				introduction: "Photographer in Michigan.",
				portraits: [
					{
						key: "portrait",
						order: 0,
						altText: "Jesse outdoors",
						asset: { ...asset, source: { ...asset.source, sha256: sourceSha256 } },
					},
				],
				sections: [],
				highlights: [],
				seoDescription: "About Jesse",
			},
		},
		contact: {
			revisionId: "contact-revision",
			publishedAt: 2000,
			payload: {
				heading: "Get in touch",
				intro: "Tell me about your project.\r\n\r\nI will reply soon.",
				email: "hello@example.com",
				confirmationMessage: "Thank you for your message.",
				booking: {
					enabled: true,
					url: "https://cal.com/jesse/session",
					label: "Book",
					intro: "Choose a time.",
				},
				inquiryChoices: ["Portraits", "Prints"],
			},
		},
	};
}

function provider(value: unknown) {
	return createAboutContactContentProvider({
		createReader: () => ({ loadPublished: async () => value }),
	});
}

describe("published About and Contact", () => {
	it("projects the portrait, paragraphs and booking destination for the public page", async () => {
		await expect(provider(publishedContent()).load()).resolves.toEqual({
			siteUrl: SITE_URL,
			about: {
				displayName: "Jesse",
				introduction: "Photographer in Michigan.",
				portrait: {
					src: `${assetRoot}/display-1280.webp`,
					altText: "Jesse outdoors",
					sourceSha256,
				},
				seo: { description: "About Jesse", imageUrl: null },
			},
			contact: {
				heading: "Get in touch",
				intro: ["Tell me about your project.", "I will reply soon."],
				email: "hello@example.com",
				phone: null,
				confirmationMessage: "Thank you for your message.",
				booking: {
					enabled: true,
					url: "https://cal.com/jesse/session",
					calLink: "jesse/session",
					label: "Book",
					intro: "Choose a time.",
				},
				inquiryChoices: ["Portraits", "Prints"],
			},
		});
	});

	it("keeps disabled booking without a destination", async () => {
		const state = publishedContent();
		const { url: _, ...booking } = state.contact.payload.booking;
		await expect(
			provider({
				...state,
				contact: {
					...state.contact,
					payload: {
						...state.contact.payload,
						booking: { ...booking, enabled: false },
					},
				},
			}).load(),
		).resolves.toMatchObject({
			contact: { booking: { enabled: false, url: null, calLink: null } },
		});
	});

	it.each([
		"about",
		"contact",
	])("does not publish a partial page when %s is absent", async (key) => {
		await expect(provider({ ...publishedContent(), [key]: null }).load()).rejects.toMatchObject({
			status: 503,
		});
	});

	it.each([
		"https://example.com/jesse/session",
		"https://cal.com/jesse/session?redirect=elsewhere",
		"javascript:alert(1)",
	])("rejects an invalid booking destination: %s", async (url) => {
		const state = publishedContent();
		state.contact.payload.booking.url = url;
		await expect(provider(state).load()).rejects.toMatchObject({ status: 503 });
	});

	it("rejects ambiguous inquiry choices", async () => {
		const state = publishedContent();
		state.contact.payload.inquiryChoices = ["Portraits", "portraits"];
		await expect(provider(state).load()).rejects.toMatchObject({ status: 503 });
	});

	it("normalizes failed reads to unavailable", async () => {
		const loadPublished = vi.fn().mockRejectedValue(new Error("Backend unavailable"));
		await expect(
			createAboutContactContentProvider({ createReader: () => ({ loadPublished }) }).load(),
		).rejects.toMatchObject({ status: 503 });
	});

	it("uses the separately published Instagram link and rejects ambiguous settings", () => {
		expect(projectSiteSettingsInstagramUrl(null)).toBeNull();
		const link = { platform: "instagram", url: "https://instagram.com/example" };
		expect(projectSiteSettingsInstagramUrl({ socialLinks: [link] })).toBe(link.url);
		expect(() => projectSiteSettingsInstagramUrl({ socialLinks: [link, link] })).toThrow();
	});
});
