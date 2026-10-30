import { type Cookies, error } from "@sveltejs/kit";
import { getFunctionName } from "convex/server";
import { beforeEach, expect, it, vi } from "vitest";
import { createPreview, loadDraftPreview } from "../draftPreview";
import { assetId, assetRoot, sourceSha256, webAsset } from "./fixtures/publicContent";

const state = vi.hoisted(() => ({
	query: vi.fn(),
	setAuth: vi.fn(),
	requireAuth: vi.fn(),
	membership: vi.fn(),
	token: "synthetic-owner-session",
	revision: "draft-one",
}));
vi.mock("../adminAuth", () => ({ requireAuthWithIdentity: state.requireAuth }));
vi.mock("../siteAdminAuthorization", () => ({ getSiteAdminAccess: state.membership }));
vi.mock("../runtimeConfig", () => ({ getConvexUrl: () => "https://fixture.convex.cloud" }));
vi.mock("convex/browser", () => ({
	ConvexHttpClient: class {
		query = state.query;
		setAuth = state.setAuth;
	},
}));
const cookies: Cookies = {
	get: () => undefined,
	getAll: () => [],
	set: vi.fn(),
	delete: vi.fn(),
	serialize: () => "",
};
const about = () => ({
	revisionId: state.revision,
	publishedAt: 1,
	payload: {
		heading: "About",
		displayName: "Fixture artist",
		introduction: "Unpublished introduction",
		portraits: [
			{
				key: "portrait",
				order: 0,
				altText: "Fixture portrait",
				asset: {
					...webAsset(),
					source: { ...webAsset().source, sha256: sourceSha256 },
				},
			},
		],
		sections: [],
		highlights: [],
		seoDescription: "Private description",
	},
});
const contact = () => ({
	revisionId: state.revision,
	publishedAt: 1,
	payload: {
		heading: "Private contact",
		intro: "Unpublished contact copy",
		email: "fixture@example.com",
		confirmationMessage: "Thank you",
		booking: { enabled: false, label: "Book", intro: "Choose a time" },
		inquiryChoices: [],
	},
});

beforeEach(() => {
	vi.resetAllMocks();
	state.token = "synthetic-owner-session";
	state.revision = "draft-one";
	state.requireAuth.mockImplementation(async () => ({
		token: state.token,
		identity: { email: "owner@example.com" },
	}));
	state.membership.mockResolvedValue({ authorized: true });
	state.query.mockImplementation(async (ref, args) => {
		expect(args.siteUrl).toBe("angelsrest.online");
		const name = getFunctionName(ref);
		if (name.endsWith("DraftPreview") && args.draftRevisionId !== state.revision)
			throw new Error("Draft changed");
		switch (name) {
			case "content:getAboutPageDraftPreview":
				return about();
			case "content:getContactPageDraftPreview":
				return contact();
			case "content:getPublishedAboutContactWithRevisions":
				return { about: about(), contact: contact() };
			case "content:getSiteSettingsDraftPreview":
				return {
					artistName: "Fixture artist",
					siteTitle: "Private site title",
					tagline: "Photographs",
					socialLinks: [],
					seoDescription: "Private description",
					seoOgImage: { assetId, url: `${assetRoot}/display-2048.webp`, sourceSha256 },
				};
			case "portfolioGalleries:getDraftPreview":
				return {
					galleryId: "gallery-one",
					revisionId: state.revision,
					sourceDocumentId: null,
					sourceDocumentRevision: null,
					title: "Hidden draft",
					slug: "hidden-draft",
					description: "Unpublished gallery",
					portfolioOrder: 0,
					isVisible: false,
					publishedAt: 1,
					seo: { description: null, ogImage: null },
					placements: [],
				};
			case "catalogProductGraphs:getDraftPreview":
				return {
					schemaVersion: 2,
					productId: "product-one",
					revisionId: state.revision,
					productKind: "zine",
					title: "Private zine",
					slug: "private-zine",
					description: "Private product",
					seoDescription: null,
					currency: "usd",
					saleAvailability: "available",
					shopPlacement: { featured: false, orderRank: null },
					variants: [
						{
							key: "default",
							order: 0,
							retailPriceCents: 2400,
							materialOption: null,
							sizeOption: null,
						},
					],
					media: [
						{
							key: "cover",
							role: "gallery",
							order: 0,
							altText: "Zine cover",
							asset: {
								...webAsset(),
								derivatives: Object.fromEntries(
									Object.entries(webAsset().derivatives).map(
										([key, { contentType, width, height }]) => [
											key,
											{ contentType, width, height },
										],
									),
								),
							},
						},
					],
				};
			default:
				throw new Error("Unexpected preview read");
		}
	});
});

async function issue(kind: string, body = { draftRevisionId: "draft-one" }) {
	const url = new URL(`https://angelsrest.online/api/admin/draft-preview/${kind}`);
	return createPreview({
		url,
		cookies,
		params: { kind },
		request: new Request(url, {
			method: "POST",
			headers: { origin: url.origin, "content-type": "application/json" },
			body: JSON.stringify(body),
		}),
	});
}

it.each([
	["settings", "/", {}],
	["about", "/about", {}],
	["contact", "/about", {}],
	["portfolio", "/gallery/hidden-draft", { galleryId: "gallery-one" }],
	["product", "/shop/private-zine", { productId: "product-one" }],
] as const)("renders %s through its real public projection without publishing", async (kind, path, resource) => {
	const response = await issue(kind, { draftRevisionId: "draft-one", ...resource });
	expect(response.status).toBe(200);
	expect(response.headers.get("cache-control")).toContain("no-store");
	const { previewUrl } = await response.json();
	const url = new URL(previewUrl, "https://angelsrest.online");
	expect(url.pathname).toBe(path);
	const preview = await loadDraftPreview(url, cookies);
	expect(preview?.kind).toBe(kind);
	if (preview?.kind === "about")
		expect(preview.content.about.introduction).toBe("Unpublished introduction");
	if (preview?.kind === "portfolio") expect(preview.gallery?.title).toBe("Hidden draft");
	if (preview?.kind === "product" && "product" in preview.product)
		expect(preview.product.product.title).toBe("Private zine");
	expect(state.membership).toHaveBeenCalledTimes(2);
	expect(state.setAuth.mock.calls.map(([token]) => token)).toEqual([state.token, state.token]);
});

it("does no private work for ordinary public visits and rejects anonymous or foreign members first", async () => {
	expect(await loadDraftPreview(new URL("https://angelsrest.online/about"), cookies)).toBeNull();
	expect(state.requireAuth).not.toHaveBeenCalled();
	state.requireAuth.mockImplementationOnce(() => error(401, "Sign in"));
	await expect(issue("about")).rejects.toMatchObject({ status: 401 });
	state.membership.mockResolvedValueOnce({ authorized: false });
	await expect(issue("about")).rejects.toMatchObject({ status: 403 });
	expect(state.query).not.toHaveBeenCalled();
});

it("rejects a changed draft, changed session, or a different public route", async () => {
	const { previewUrl } = await (await issue("about")).json();
	const url = new URL(previewUrl, "https://angelsrest.online");
	state.revision = "newer-draft";
	await expect(loadDraftPreview(url, cookies)).rejects.toMatchObject({ status: 409 });
	state.revision = "draft-one";
	state.token = "another-session";
	await expect(loadDraftPreview(url, cookies)).rejects.toMatchObject({ status: 409 });
	state.token = "synthetic-owner-session";
	url.pathname = "/shop";
	await expect(loadDraftPreview(url, cookies)).rejects.toMatchObject({ status: 409 });
});
