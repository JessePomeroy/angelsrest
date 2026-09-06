import type { GenericId } from "convex/values";
import type { PageData } from "../../../src/routes/delivery/[token]/$types";

export const preview =
	"data:image/svg+xml," +
	encodeURIComponent(
		'<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="#74828f"/></svg>',
	);

// These synthetic branded IDs are confined to the fixture; no provider receives them.
export const deliveryData = {
	siteSettings: {
		artistName: null,
		siteTitle: null,
		tagline: null,
		logoUrl: null,
		socialLinks: [],
		seo: { description: null, ogImageUrl: null, keywords: [] },
	},
	gallery: {
		_id: "fixture-gallery" as GenericId<"galleries">,
		slug: "fixture-gallery",
		status: "published",
		passwordProtected: false,
		name: "Fixture delivery gallery",
		imageCount: 4,
		favoritesEnabled: false,
		downloadEnabled: false,
	},
	images: Array.from({ length: 4 }, (_, index) => ({
		_id: `fixture-image-${index}` as GenericId<"galleryImages">,
		_creationTime: 0,
		galleryId: "fixture-gallery" as GenericId<"galleries">,
		r2Key: `fixture-${index}.jpg`,
		order: index,
		width: 640,
		height: 480,
		sizeBytes: 100,
		downloadCount: 0,
		siteUrl: "https://fixture.invalid",
		previewSource: "self",
		filename: `photo-${index + 1}.jpg`,
		isVideo: false,
		canPreview: true,
		isFavorite: false,
		fileLabel: "image",
		thumbUrl: preview,
		previewUrl: preview,
		downloadUrl: "/fixture-download",
	})),
	token: "fixture-token",
	accessGrant: "",
	workerUrl: "https://fixture.invalid",
	requiresPassword: false,
	client: { name: "Fixture client" },
} satisfies PageData;

export const printSetData = {
	siteSettings: deliveryData.siteSettings,
	printSet: {
		title: "Fixture print set",
		slug: "fixture-print-set",
		description: "A local print set for theme checks.",
		previewImage: preview,
		variants: [
			{ paper: "archival-matte", size: "8x10", retailPrice: 25 },
			{ paper: "archival-matte", size: "11x14", retailPrice: 35 },
		],
		inStock: true,
		bordersEnabled: true,
		framedEnabled: true,
		frameMarkupMultiplier: 1,
	},
	images: [{ full: preview, thumb: preview, original: preview, alt: "Fixture print" }],
} satisfies import("../../../src/routes/shop/sets/[slug]/$types").PageData;
