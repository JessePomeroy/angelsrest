import { convexTest } from "convex-test";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import type { CatalogProductGraphV2Draft } from "../convex/helpers/catalogProductGraphValidators";
import type { CatalogProductDraft, CatalogProductKind } from "../convex/helpers/catalogProductValidators";
import schema from "../convex/schema";

export const SITE_A = { siteUrl: "site-a.example", email: "admin-a@example.com" };
export const SITE_B = { siteUrl: "site-b.example", email: "admin-b@example.com" };

export function workerAssetId(site: "a" | "b" | "m", index: number) {
	const prefix = site === "a" ? "10000000" : site === "b" ? "20000000" : "30000000";
	return `${prefix}-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

export function readyAsset(siteUrl: string, assetId: string) {
	const prefix = `sites/${siteUrl}/web/${assetId}/`;
	return {
		assetId,
		originalFilename: `${assetId}.jpg`,
		source: {
			contentType: "image/jpeg" as const,
			sizeBytes: 1_000_000,
			width: 3000,
			height: 2000,
		},
		master: {
			key: `${prefix}master.webp`,
			contentType: "image/webp" as const,
			sizeBytes: 700_000,
			width: 3000,
			height: 2000,
		},
		derivatives: {
			thumb: {
				key: `${prefix}thumb.webp`,
				contentType: "image/webp" as const,
				width: 320,
				height: 213,
			},
			card: {
				key: `${prefix}card.webp`,
				contentType: "image/webp" as const,
				width: 768,
				height: 512,
			},
			display1280: {
				key: `${prefix}display-1280.webp`,
				contentType: "image/webp" as const,
				width: 1280,
				height: 853,
			},
			display2048: {
				key: `${prefix}display-2048.webp`,
				contentType: "image/webp" as const,
				width: 2048,
				height: 1365,
			},
			display2560: {
				key: `${prefix}display-2560.webp`,
				contentType: "image/webp" as const,
				width: 2560,
				height: 1707,
			},
		},
	};
}

export function printSourceAsset(siteUrl: string, assetKey: string, index: number) {
	return {
		siteUrl,
		assetKey,
		privateObjectKey: `sites/${siteUrl}/catalog/print-sources/${assetKey}/original`,
		status: "verified" as const,
		originalFilename: `${assetKey}.jpg`,
		mimeType: "image/jpeg" as const,
		sizeBytes: 25_000_000,
		widthPixels: 8000,
		heightPixels: 6000,
		sha256: (index % 16).toString(16).repeat(64),
		provenance: {
			provider: "editor_upload" as const,
			sourceId: `print-source-${assetKey}`,
		},
		createdAt: 100 + index,
		createdBy: "fixture",
		verifiedAt: 200 + index,
		verifiedBy: "fixture",
	};
}

function paidFileAsset(
	siteUrl: string,
	assetKey: string,
	index: number,
	version = "v1",
) {
	return {
		siteUrl,
		assetKey,
		privateObjectKey: `sites/${siteUrl}/catalog/paid-digital-files/${assetKey}/original`,
		status: "verified" as const,
		originalFilename: `${assetKey}.zip`,
		mimeType: "application/zip" as const,
		sizeBytes: 10_000_000,
		sha256: ((index + 8) % 16).toString(16).repeat(64),
		version,
		provenance: {
			provider: "editor_upload" as const,
			sourceId: `paid-file-${assetKey}`,
		},
		createdAt: 100 + index,
		createdBy: "fixture",
		verifiedAt: 200 + index,
		verifiedBy: "fixture",
	};
}

export async function setup(modules: Record<string, () => Promise<unknown>>) {
	const t = convexTest(schema, modules);
	for (const site of [SITE_A, SITE_B]) {
		await t.mutation(internal.platform.seedClient, {
			name: site.siteUrl,
			email: site.email,
			siteUrl: site.siteUrl,
			tier: "full",
			subscriptionStatus: "active",
			adminEmails: [site.email],
			role: "client",
			catalogProductKinds: [
				"print",
				"print_set",
				"postcard",
				"tapestry",
				"digital_download",
				"merchandise",
			],
		});
	}
	const adminA = t.withIdentity({ subject: SITE_A.email, email: SITE_A.email });
	const adminB = t.withIdentity({ subject: SITE_B.email, email: SITE_B.email });
	const [webA, webA2, webB] = await Promise.all([
		adminA.mutation(api.mediaAssets.registerReadyWebAsset, {
			siteUrl: SITE_A.siteUrl,
			asset: readyAsset(SITE_A.siteUrl, workerAssetId("a", 1)),
		}),
		adminA.mutation(api.mediaAssets.registerReadyWebAsset, {
			siteUrl: SITE_A.siteUrl,
			asset: readyAsset(SITE_A.siteUrl, workerAssetId("a", 2)),
		}),
		adminB.mutation(api.mediaAssets.registerReadyWebAsset, {
			siteUrl: SITE_B.siteUrl,
			asset: readyAsset(SITE_B.siteUrl, workerAssetId("b", 1)),
		}),
	]);
	const privateAssets = await t.run(async (ctx) => ({
		printA: await ctx.db.insert(
			"catalogPrintSourceAssets",
			printSourceAsset(SITE_A.siteUrl, "print-a", 1),
		),
		printA2: await ctx.db.insert(
			"catalogPrintSourceAssets",
			printSourceAsset(SITE_A.siteUrl, "print-a-2", 2),
		),
		printA3: await ctx.db.insert(
			"catalogPrintSourceAssets",
			printSourceAsset(SITE_A.siteUrl, "print-a-3", 3),
		),
		printB: await ctx.db.insert(
			"catalogPrintSourceAssets",
			printSourceAsset(SITE_B.siteUrl, "print-b", 4),
		),
		paidA: await ctx.db.insert(
			"catalogDigitalFileAssets",
			paidFileAsset(SITE_A.siteUrl, "paid-a", 1),
		),
		paidA2: await ctx.db.insert(
			"catalogDigitalFileAssets",
			paidFileAsset(SITE_A.siteUrl, "paid-a-2", 2, "v2"),
		),
		paidB: await ctx.db.insert(
			"catalogDigitalFileAssets",
			paidFileAsset(SITE_B.siteUrl, "paid-b", 3),
		),
	}));
	return {
		t,
		adminA,
		adminB,
		webA: webA.id,
		webA2: webA2.id,
		webB: webB.id,
		...privateAssets,
	};
}

export type Fixture = Awaited<ReturnType<typeof setup>>;
export type Admin = Fixture["adminA"];

export function slugFor(value: string) {
	return value.replace(/_/g, "-");
}

export function commonGraph(slug: string) {
	return {
		schemaVersion: 2 as const,
		title: `Product ${slug}`,
		slug,
		description: `Private draft for ${slug}.`,
		seoDescription: `Search description for ${slug}.`,
		currency: "usd" as const,
		saleAvailability: "available" as const,
		shopPlacement: { featured: false, orderRank: `rank-${slug}` },
	};
}

function fixedPriceVariant(price = 4_200) {
	return [{
		key: "default",
		order: 0,
		retailPriceCents: price,
		status: "enabled" as const,
	}];
}

type DraftOf<Kind extends CatalogProductKind> = Extract<
	CatalogProductGraphV2Draft,
	{ productKind: Kind }
>;
type DraftAssets = Pick<Fixture, "webA" | "webA2" | "printA" | "printA2" | "paidA">;

export function graphDraft<Kind extends CatalogProductKind>(
	kind: Kind,
	assets: DraftAssets,
	suffix: string = kind,
): DraftOf<Kind> {
	const slug = slugFor(suffix);
	const common = commonGraph(slug);
	if (kind === "print") {
		return {
			...common,
			productKind: "print",
			fulfillmentMode: "production_partner",
			printOptions: {
				borderOptionsEnabled: true,
				frameOptionsEnabled: true,
				framePriceMultiplierBasisPoints: 12_500,
			},
			variants: [{
				key: "matte-small",
				order: 0,
				materialOptionKey: "matte",
				sizeOptionKey: "8x10",
				retailPriceCents: 4_200,
				status: "enabled",
			}],
			webMedia: [
				{ key: "primary", order: 0, role: "primary", assetId: assets.webA, altText: "Primary print" },
				{ key: "detail", order: 0, role: "gallery", assetId: assets.webA2, altText: "Print detail" },
			],
			printSources: [{ key: "master", order: 0, assetId: assets.printA }],
		} as DraftOf<Kind>;
	}
	if (kind === "print_set") {
		return {
			...common,
			productKind: "print_set",
			fulfillmentMode: "production_partner",
			printOptions: {
				borderOptionsEnabled: false,
				frameOptionsEnabled: true,
				framePriceMultiplierBasisPoints: 10_000,
			},
			variants: [{
				key: "set-matte-small",
				order: 0,
				materialOptionKey: "matte",
				sizeOptionKey: "8x10",
				retailPriceCents: 8_000,
				status: "enabled",
			}],
			webMedia: [
				{ key: "cover", order: 0, role: "cover", assetId: assets.webA, altText: "Set cover" },
				{ key: "member-1-media", order: 0, role: "set_member", assetId: assets.webA, altText: "First set member" },
				{ key: "member-2-media", order: 1, role: "set_member", assetId: assets.webA2, altText: "Second set member" },
			],
			printSources: [
				{ key: "member-1-source", order: 0, assetId: assets.printA },
				{ key: "member-2-source", order: 1, assetId: assets.printA2 },
			],
			setMembers: [
				{ key: "member-1", order: 0, mediaPlacementKey: "member-1-media", printSourceKey: "member-1-source" },
				{ key: "member-2", order: 1, mediaPlacementKey: "member-2-media", printSourceKey: "member-2-source" },
			],
		} as DraftOf<Kind>;
	}
	if (kind === "digital_download") {
		return {
			...common,
			productKind: "digital_download",
			fulfillmentMode: "digital_delivery",
			variants: fixedPriceVariant(1_500),
			webMedia: [{ key: "gallery", order: 0, role: "gallery", assetId: assets.webA, altText: "Download cover" }],
			paidFile: { key: "download", assetId: assets.paidA, version: "v1" },
		} as DraftOf<Kind>;
	}
	return {
		...common,
		productKind: kind,
		fulfillmentMode: "merchant_fulfilled",
		variants: fixedPriceVariant(),
		webMedia: [{ key: "gallery", order: 0, role: "gallery", assetId: assets.webA, altText: `${kind} image` }],
	} as DraftOf<Kind>;
}

export function v1Draft(slug: string): CatalogProductDraft {
	return {
		title: `V1 ${slug}`,
		slug,
		description: "Existing single-print draft.",
		fulfillmentMode: "production_partner",
		saleAvailability: "available",
		borderOptionsEnabled: false,
		frameOptionsEnabled: true,
		framePriceMultiplierBasisPoints: 12_500,
		variants: [{
			key: "matte-small",
			materialOptionKey: "matte",
			sizeOptionKey: "8x10",
			retailPriceCents: 4_200,
			status: "enabled",
		}],
	};
}

export async function createGraph(
	admin: Admin,
	siteUrl: string,
	productKey: string,
	draft: CatalogProductGraphV2Draft,
) {
	return await admin.mutation(api.catalogProductGraphs.createDraft, {
		siteUrl,
		productKey,
		draft,
	});
}

export async function saveGraph(
	admin: Admin,
	productId: Id<"catalogProducts">,
	draft: CatalogProductGraphV2Draft,
	expectedDraftRevisionId?: Id<"catalogProductRevisions">,
) {
	return await admin.mutation(api.catalogProductGraphs.saveDraft, {
		productId,
		...(expectedDraftRevisionId ? { expectedDraftRevisionId } : {}),
		draft,
	});
}

export async function graphRows(fixture: Fixture, revisionId: Id<"catalogProductRevisions">) {
	return await fixture.t.run(async (ctx) => {
		const revision = await ctx.db.get(revisionId);
		if (!revision) throw new Error("Fixture revision not found");
		const productId = revision.productId;
		return {
			revision,
			variants: await ctx.db.query("catalogProductVariants")
				.withIndex("by_revisionId_and_order", (q) => q.eq("revisionId", revisionId)).collect(),
			media: await ctx.db.query("catalogProductMediaPlacements")
				.withIndex("by_productId_and_revisionId", (q) =>
					q.eq("productId", productId).eq("revisionId", revisionId)
				).collect(),
			printSources: await ctx.db.query("catalogProductPrintSources")
				.withIndex("by_revisionId_and_order", (q) => q.eq("revisionId", revisionId)).collect(),
			setMembers: await ctx.db.query("catalogProductSetMembers")
				.withIndex("by_revisionId_and_order", (q) => q.eq("revisionId", revisionId)).collect(),
			digitalFiles: await ctx.db.query("catalogProductDigitalFiles")
				.withIndex("by_revisionId", (q) => q.eq("revisionId", revisionId)).collect(),
			shopPlacements: await ctx.db.query("catalogProductShopPlacements")
				.withIndex("by_revisionId", (q) => q.eq("revisionId", revisionId)).collect(),
		};
	});
}

export async function storedCounts(fixture: Fixture) {
	return await fixture.t.run(async (ctx) => ({
		products: (await ctx.db.query("catalogProducts").collect()).length,
		revisions: (await ctx.db.query("catalogProductRevisions").collect()).length,
		variants: (await ctx.db.query("catalogProductVariants").collect()).length,
		media: (await ctx.db.query("catalogProductMediaPlacements").collect()).length,
		printSources: (await ctx.db.query("catalogProductPrintSources").collect()).length,
		setMembers: (await ctx.db.query("catalogProductSetMembers").collect()).length,
		digitalFiles: (await ctx.db.query("catalogProductDigitalFiles").collect()).length,
		shopPlacements: (await ctx.db.query("catalogProductShopPlacements").collect()).length,
	}));
}
