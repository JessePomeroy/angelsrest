/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
	createGraph,
	graphDraft,
	saveGraph,
	SITE_A,
	SITE_B,
	setup,
	storedCounts,
} from "../test/catalogProductGraphFixtures";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { CatalogCommerceRequest } from "./helpers/catalogCommerce";
import { parseCatalogCommerceRequest } from "./helpers/catalogCommerce";
import { serverSecretFingerprint } from "./helpers/serverSecrets";

const modules = import.meta.glob("./**/*.ts");
const PATHS = {
	checkout: "/commerce/catalog/checkout/resolve",
	paid_fulfillment: "/commerce/catalog/paid-fulfillment/resolve",
	paid_download: "/commerce/catalog/paid-download/resolve",
} as const;
const SECRET = "catalog-commerce-checkout-secret-0123456789abcdef";
const FULFILLMENT_SECRET = "catalog-commerce-fulfillment-secret-0123456789abcdef";
const DOWNLOAD_SECRET = "catalog-commerce-download-secret-0123456789abcdef";
const SESSION = "cs_test_1234567890catalogcommerce";
const AUTHORITY_ENV = [
	"CATALOG_COMMERCE_CHECKOUT_RESOLVER_SECRETS",
	"CATALOG_COMMERCE_PAID_FULFILLMENT_RESOLVER_SECRETS",
	"CATALOG_COMMERCE_PAID_DOWNLOAD_RESOLVER_SECRETS",
	"CHECKOUT_ROLE_CREDENTIAL_FINGERPRINTS",
	"CATALOG_PRIVATE_ASSET_EDITOR_HOST_JOURNAL_SECRETS",
	"CATALOG_PRIVATE_ASSET_EDITOR_INSPECTION_CLAIM_SECRETS",
	"CATALOG_PRIVATE_EDITOR_UPLOAD_CONTROL_SECRETS",
	"CATALOG_PRIVATE_ASSET_STORAGE_RECEIPT_SECRETS",
	"CATALOG_PRIVATE_ASSET_INSPECTION_RECEIPT_SECRETS",
	"CMS_MEDIA_DELETION_COMPLETION_SECRETS",
	"CHECKOUT_SNAPSHOT_RESERVATION_SECRETS",
	"BETTER_AUTH_SECRET",
	"AUTH_GOOGLE_SECRET",
	"STRIPE_SECRET_KEY",
	"WEBHOOK_SECRET",
	"ORDER_LOOKUP_SECRET",
	"SITE_URL",
] as const;
const priorEnv = new Map<string, string | undefined>();

beforeEach(() => {
	for (const name of AUTHORITY_ENV) {
		priorEnv.set(name, process.env[name]);
		delete process.env[name];
	}
	process.env.CATALOG_COMMERCE_CHECKOUT_RESOLVER_SECRETS = JSON.stringify({
		[SITE_A.siteUrl]: [SECRET],
	});
	process.env.CATALOG_COMMERCE_PAID_FULFILLMENT_RESOLVER_SECRETS = JSON.stringify({
		[SITE_A.siteUrl]: [FULFILLMENT_SECRET],
	});
	process.env.CATALOG_COMMERCE_PAID_DOWNLOAD_RESOLVER_SECRETS = JSON.stringify({
		[SITE_A.siteUrl]: [DOWNLOAD_SECRET],
	});
	process.env.CHECKOUT_ROLE_CREDENTIAL_FINGERPRINTS = JSON.stringify({
		checkoutBridge: ["a".repeat(64)],
		checkoutSnapshotReservation: ["b".repeat(64)],
	});
	process.env.SITE_URL = "https://www.angelsrest.online";
});

afterEach(() => {
	for (const name of AUTHORITY_ENV) {
		const value = priorEnv.get(name);
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
	priorEnv.clear();
});

type Fixture = Awaited<ReturnType<typeof setup>>;
type Created = Awaited<ReturnType<typeof createGraph>>;

async function product(fixture: Fixture, productId: Id<"catalogProducts">) {
	const value = await fixture.t.run((ctx) => ctx.db.get(productId));
	if (!value) throw new Error("Missing product fixture");
	return value;
}

async function publish(fixture: Fixture, created: Created) {
	const value = await product(fixture, created.productId);
	await fixture.adminA.mutation(api.catalogProductGraphs.publishDraft, {
		productId: created.productId,
		expectedDraftRevisionId: value.draftRevisionId ?? null,
		expectedPublishedRevisionId: value.publishedRevisionId ?? null,
		expectedUpdatedAt: value.updatedAt,
	});
}

function item(created: Created, kind: CatalogCommerceRequest extends never ? never : string,
	overrides: Record<string, unknown> = {}) {
	const isPrint = kind === "print" || kind === "print_set";
	return {
		productKey: created.productId,
		revisionId: created.revisionId,
		productKind: kind,
		variantKey: kind === "print" ? "matte-small" : kind === "print_set" ? "set-matte-small" : "default",
		materialOptionKey: isPrint ? "archival-matte" : null,
		sizeOptionKey: isPrint ? "8x10" : null,
		borderOptionKey: isPrint ? "none" : null,
		frameOptionKey: isPrint ? "none" : null,
		...overrides,
	} as Extract<CatalogCommerceRequest, { purpose: "checkout" }>["item"];
}

function checkout(itemValue: ReturnType<typeof item>) {
	return { version: 1, purpose: "checkout", item: itemValue } as const;
}

async function resolve(fixture: Fixture, request: CatalogCommerceRequest) {
	return await fixture.t.query(internal.orders.catalogCommerce, {
		siteUrl: SITE_A.siteUrl,
		request,
	});
}

async function seedOrder(
	fixture: Fixture,
	itemValue: ReturnType<typeof item>,
	session = SESSION,
	status: "new" | "refunded" = "new",
) {
	await fixture.t.run((ctx) => ctx.db.insert("orders", {
		siteUrl: SITE_A.siteUrl,
		orderNumber: `ORDER-${session}`,
		stripeSessionId: session,
		checkoutSnapshot: { schemaVersion: 1, catalogProvider: "convex", items: [itemValue] },
		customerEmail: "buyer@example.com",
		items: [{ productName: "Stored", quantity: 1, price: 1 }],
		total: 1,
		fulfillmentType: itemValue.productKind === "digital_download" ? "digital" : "self",
		status,
	}));
}

function paid(purpose: "paid_fulfillment" | "paid_download", session = SESSION, itemIndex = 0) {
	return { version: 1, purpose, stripeSessionId: session, itemIndex } as const;
}

function allKeys(value: unknown): string[] {
	if (Array.isArray(value)) return value.flatMap(allKeys);
	if (!value || typeof value !== "object") return [];
	return Object.entries(value).flatMap(([key, child]) => [key, ...allKeys(child)]);
}

describe("catalog commerce checkout", () => {
	test("resolves exact integer print pricing and preserves null versus none identity", async () => {
		const fixture = await setup(modules);
		const created = await createGraph(
			fixture.adminA, SITE_A.siteUrl, "commerce-print", graphDraft("print", fixture, "commerce-print"),
		);
		await publish(fixture, created);
		const framedItem = item(created, "print", {
			borderOptionKey: "0.25",
			frameOptionKey: "0.875-black",
		});
		const framed = await resolve(fixture, checkout(framedItem));
		expect(framed).toMatchObject({
			purpose: "checkout",
			item: framedItem,
			identity: { productId: created.productId, revisionId: created.revisionId, productKind: "print" },
			commerce: {
				currency: "usd",
				amountCents: 6_710,
				finish: {
					materialKey: "archival-matte", sizeKey: "8x10",
					borderKey: "0.25", frameKey: "0.875-black",
					paper: { name: "Archival Matte", subcategoryId: 103001 },
					size: { width: 8, height: 10 },
					border: { inches: 0.25 }, frame: { subcategoryId: 105001 }, canvas: null,
				},
			},
		});
		expect(framed).not.toHaveProperty("descriptor");
		expect(framed.media[0]).not.toHaveProperty("privateObjectKey");
		const nullFinish = await resolve(fixture, checkout(item(created, "print", {
			borderOptionKey: null, frameOptionKey: null,
		})));
		expect(nullFinish.commerce.amountCents).toBe(4_200);
		expect(nullFinish.item).toMatchObject({ borderOptionKey: null, frameOptionKey: null });
		const noneFinish = await resolve(fixture, checkout(item(created, "print")));
		expect(noneFinish.item).toMatchObject({ borderOptionKey: "none", frameOptionKey: "none" });
	});

	test("returns only fulfillment-required media for every product kind", async () => {
		const fixture = await setup(modules);
		const cases = [
			["print", ["primary"], ["primary"]],
			["print_set", ["cover", "set_member", "set_member"],
				["cover", "member-1-media", "member-2-media"]],
			["postcard", ["gallery"], ["gallery"]],
			["tapestry", ["gallery"], ["gallery"]],
			["digital_download", ["gallery"], ["gallery"]],
			["merchandise", ["gallery"], ["gallery"]],
		] as const;
		for (const [kind, expectedRoles, expectedKeys] of cases) {
			const draft = graphDraft(kind, fixture, `media-${kind}`);
			if (draft.productKind === "print" || draft.productKind === "print_set") {
				draft.webMedia.push({
					key: "social",
					order: 0,
					role: "social_share",
					assetId: fixture.webA2,
					altText: "Optional share card",
				});
			} else {
				draft.webMedia.push(
					{
						key: "gallery-2",
						order: 1,
						role: "gallery",
						assetId: fixture.webA2,
						altText: "Optional gallery image",
					},
					{
						key: "social",
						order: 0,
						role: "social_share",
						assetId: fixture.webA2,
						altText: "Optional share card",
					},
				);
			}
			const created = await createGraph(
				fixture.adminA,
				SITE_A.siteUrl,
				`media-${kind}`,
				draft,
			);
			await publish(fixture, created);
			const result = await resolve(fixture, checkout(item(created, kind)));
			expect(result.media.map(({ role }) => role)).toEqual(expectedRoles);
			expect(result.media.map(({ key }) => key)).toEqual(expectedKeys);
			expect(result.media.every(({ altText }) => altText === null)).toBe(true);
		}
	});

	test("keeps the maximum twenty-member print-set checkout envelope bounded", async () => {
		const fixture = await setup(modules);
		const draft = graphDraft("print_set", fixture, "maximum-commerce-set");
		const maximumKey = (prefix: string, index: number) => {
			const beginning = `${prefix}-${index}-`;
			return `${beginning}${"x".repeat(120 - beginning.length)}`;
		};
		const members = Array.from({ length: 20 }, (_, index) => ({
			mediaKey: maximumKey("media", index),
			sourceKey: maximumKey("source", index),
			memberKey: maximumKey("member", index),
		}));
		draft.title = "t".repeat(160);
		draft.description = "d".repeat(5_000);
		draft.seoDescription = "s".repeat(320);
		draft.webMedia = [
			{
				key: maximumKey("cover", 0),
				order: 0,
				role: "cover",
				assetId: fixture.webA,
				altText: "界".repeat(1_000),
			},
			...members.map(({ mediaKey }, index) => ({
				key: mediaKey,
				order: index,
				role: "set_member" as const,
				assetId: index % 2 === 0 ? fixture.webA : fixture.webA2,
				altText: "界".repeat(1_000),
			})),
			{
				key: maximumKey("social", 0),
				order: 0,
				role: "social_share",
				assetId: fixture.webA2,
				altText: "a".repeat(1_000),
			},
		];
		draft.printSources = members.map(({ sourceKey }, index) => ({
			key: sourceKey,
			order: index,
			assetId: fixture.printA,
		}));
		draft.setMembers = members.map(({ mediaKey, sourceKey, memberKey }, index) => ({
			key: memberKey,
			order: index,
			mediaPlacementKey: mediaKey,
			printSourceKey: sourceKey,
		}));
		const created = await createGraph(
			fixture.adminA,
			SITE_A.siteUrl,
			"maximum-commerce-set",
			draft,
		);
		await publish(fixture, created);
		const result = await resolve(fixture, checkout(item(created, "print_set")));
		expect(result.media).toHaveLength(21);
		expect(result.media.map(({ role }) => role)).toEqual([
			"cover",
			...Array.from({ length: 20 }, () => "set_member"),
		]);
		expect(result.media.some(({ role }) => role === "social_share")).toBe(false);
		expect(result.media.every(({ altText }) => altText === null)).toBe(true);
		expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThan(64 * 1024);
	});

	test("fails closed when a print set has no member fulfillment media", async () => {
		const fixture = await setup(modules);
		const draft = graphDraft("print_set", fixture, "missing-member-media");
		draft.saleAvailability = "unavailable";
		draft.webMedia = draft.webMedia.filter(({ role }) => role !== "set_member");
		draft.printSources = [];
		draft.setMembers = [];
		const created = await createGraph(
			fixture.adminA,
			SITE_A.siteUrl,
			"missing-member-media",
			draft,
		);
		await seedOrder(fixture, item(created, "print_set"));
		await expect(resolve(fixture, paid("paid_fulfillment"))).rejects.toThrow(
			/Catalog commerce resolution rejected/,
		);
	});

	test("requires exact current identity, policy, availability, variant, finish, and private relation", async () => {
		const fixture = await setup(modules);
		const print = await createGraph(
			fixture.adminA, SITE_A.siteUrl, "failure-print", graphDraft("print", fixture, "failure-print"),
		);
		const other = await createGraph(
			fixture.adminA, SITE_A.siteUrl, "failure-other", graphDraft("postcard", fixture, "failure-other"),
		);
		const unavailableDraft = graphDraft("print", fixture, "failure-unavailable");
		unavailableDraft.saleAvailability = "unavailable";
		const unavailable = await createGraph(
			fixture.adminA, SITE_A.siteUrl, "failure-unavailable", unavailableDraft,
		);
		await publish(fixture, print);
		await publish(fixture, unavailable);
		const reject = async (candidate: ReturnType<typeof item>) =>
			await expect(resolve(fixture, checkout(candidate))).rejects.toThrow();
		await reject(item(print, "postcard"));
		await reject(item(print, "print", { revisionId: other.revisionId }));
		await reject(item(print, "print", { productKey: other.productId }));
		await reject(item(unavailable, "print"));
		await reject(item(print, "print", { variantKey: "missing" }));
		await reject(item(print, "print", { materialOptionKey: "glossy" }));
		await reject(item(print, "print", { borderOptionKey: "1", frameOptionKey: "0.875-black" }));
		await fixture.t.run(async (ctx) => {
			const variant = await ctx.db.query("catalogProductVariants")
				.withIndex("by_revisionId_and_variantKey", (query) =>
					query.eq("revisionId", print.revisionId).eq("variantKey", "matte-small")).unique();
			if (!variant) throw new Error("Missing variant fixture");
			await ctx.db.patch(variant._id, { retailPriceCents: undefined });
		});
		await reject(item(print, "print"));
		await fixture.t.run(async (ctx) => {
			const variant = await ctx.db.query("catalogProductVariants")
				.withIndex("by_revisionId_and_variantKey", (query) =>
					query.eq("revisionId", print.revisionId).eq("variantKey", "matte-small")).unique();
			if (!variant) throw new Error("Missing variant fixture");
			await ctx.db.patch(variant._id, { retailPriceCents: 4_200 });
			await ctx.db.patch(fixture.printA, { sha256: "invalid" });
		});
		await reject(item(print, "print"));
		await fixture.t.run(async (ctx) => {
			await ctx.db.patch(fixture.printA, { sha256: "1".repeat(64) });
			const client = await ctx.db.query("platformClients")
				.withIndex("by_siteUrl", (query) => query.eq("siteUrl", SITE_A.siteUrl)).unique();
			if (!client) throw new Error("Missing client fixture");
			await ctx.db.patch(client._id, { catalogProductKinds: ["postcard"] });
		});
		await reject(item(print, "print"));
	});
});

describe("paid catalog commerce", () => {
	test("returns ordered print/set, ZIP, and merchant descriptors without private metadata spill", async () => {
		const fixture = await setup(modules);
		const cases = [
			["print", "paid_fulfillment", "print_sources"],
			["print_set", "paid_fulfillment", "print_sources"],
			["digital_download", "paid_download", "paid_zip"],
			["merchandise", "paid_fulfillment", "merchant"],
		] as const;
		for (const [index, [kind, purpose, descriptorKind]] of cases.entries()) {
			const created = await createGraph(
				fixture.adminA, SITE_A.siteUrl, `paid-${kind}`, graphDraft(kind, fixture, `paid-${kind}`),
			);
			const itemValue = item(created, kind);
			const session = `cs_test_1234567890commerce${index}`;
			await seedOrder(fixture, itemValue, session);
			const result = await resolve(fixture, paid(purpose, session));
			if (!("descriptor" in result)) throw new Error("Paid result lost its descriptor");
			expect(result.descriptor.kind).toBe(descriptorKind);
			expect(result.media.map(({ role }) => role)).toEqual(
				kind === "print"
					? ["primary"]
					: kind === "print_set"
						? ["cover", "set_member", "set_member"]
						: ["gallery"],
			);
			const keys = allKeys(result);
			expect(keys).not.toEqual(expect.arrayContaining([
				"provenance", "createdBy", "verifiedBy", "grant", "capability", "actor",
			]));
			if (result.descriptor.kind === "print_sources") {
				expect(result.descriptor.sources).toHaveLength(kind === "print_set" ? 2 : 1);
				expect(result.descriptor.sources.map(({ memberKey }) => memberKey)).toEqual(
					kind === "print_set" ? ["member-1", "member-2"] : [null],
				);
				expect(result.descriptor.sources[0]).toMatchObject({
					relationKey: kind === "print_set" ? "member-1-source" : "master",
					mime: "image/jpeg", bytes: 25_000_000,
					dimensions: { width: 8000, height: 6000 },
				});
			} else if (result.descriptor.kind === "paid_zip") {
				expect(result.descriptor).toMatchObject({
					relationKey: "download", mime: "application/zip", bytes: 10_000_000,
					filename: "paid-a.zip", version: "v1",
				});
			} else expect(result.descriptor).toEqual({ kind: "merchant", source: null });
		}
		const merchantPrint = await createGraph(fixture.adminA, SITE_A.siteUrl, "paid-merchant-print", {
			...graphDraft("print", fixture, "paid-merchant-print"),
			fulfillmentMode: "merchant_fulfilled",
		});
		const merchantItem = item(merchantPrint, "print");
		await seedOrder(fixture, merchantItem, `${SESSION}merchant`);
		const merchant = await resolve(fixture, paid("paid_fulfillment", `${SESSION}merchant`));
		expect("descriptor" in merchant && merchant.descriptor).toEqual({ kind: "merchant", source: null });
	});

	test("uses the stored paid item, isolates tenant/index/purpose, and denies refunded downloads", async () => {
		const fixture = await setup(modules);
		const digital = await createGraph(
			fixture.adminA, SITE_A.siteUrl, "paid-guard-download",
			graphDraft("digital_download", fixture, "paid-guard-download"),
		);
		await seedOrder(fixture, item(digital, "digital_download"));
		process.env.WEBHOOK_SECRET = SECRET;
		const authority = await fixture.t.query(api.orders.resolvePaidDownloadOrder, {
			stripeSessionId: SESSION, webhookSecret: SECRET,
		});
		expect(authority).toMatchObject({ refunded: false, checkoutSnapshot: { catalogProvider: "convex" } });
		await expect(fixture.t.query(api.orders.resolvePaidDownloadOrder, {
			stripeSessionId: SESSION, webhookSecret: FULFILLMENT_SECRET,
		})).rejects.toThrow();
		expect((await resolve(fixture, paid("paid_download"))).identity.productId).toBe(digital.productId);
		await fixture.t.run((ctx) => ctx.db.patch(fixture.paidA, { sha256: "invalid" }));
		await expect(resolve(fixture, paid("paid_download"))).rejects.toThrow();
		await fixture.t.run((ctx) => ctx.db.patch(fixture.paidA, { sha256: "9".repeat(64) }));
		await expect(resolve(fixture, paid("paid_fulfillment"))).rejects.toThrow();
		await expect(resolve(fixture, paid("paid_download", SESSION, 1))).rejects.toThrow();
		await expect(fixture.t.query(internal.orders.catalogCommerce, {
			siteUrl: SITE_B.siteUrl, request: paid("paid_download"),
		})).rejects.toThrow();
		await fixture.t.run(async (ctx) => {
			const order = await ctx.db.query("orders")
				.withIndex("by_stripeSessionId", (query) => query.eq("stripeSessionId", SESSION)).unique();
			if (!order) throw new Error("Missing order fixture");
			await ctx.db.patch(order._id, { status: "refunded" });
		});
		await expect(resolve(fixture, paid("paid_download"))).rejects.toThrow();
		expect(await fixture.t.query(api.orders.resolvePaidDownloadOrder, {
			stripeSessionId: SESSION, webhookSecret: SECRET,
		})).toMatchObject({ refunded: true });
	});

	test("keeps historical replay isolated from corrupt active revision slugs", async () => {
		const fixture = await setup(modules);
		const created = await createGraph(
			fixture.adminA, SITE_A.siteUrl, "integrity-old",
			graphDraft("print", fixture, "integrity-old"),
		);
		await publish(fixture, created);
		await seedOrder(fixture, item(created, "print"));
		let value = await product(fixture, created.productId);
		await fixture.adminA.mutation(api.catalogProductGraphs.unpublish, {
			productId: created.productId,
			expectedDraftRevisionId: value.draftRevisionId ?? null,
			expectedPublishedRevisionId: value.publishedRevisionId ?? null,
			expectedUpdatedAt: value.updatedAt,
		});
		const middle = await saveGraph(
			fixture.adminA, created.productId,
			graphDraft("print", fixture, "integrity-middle"), created.revisionId,
		);
		await saveGraph(
			fixture.adminA, created.productId,
			graphDraft("print", fixture, "integrity-current"), middle.revisionId,
		);
		value = await product(fixture, created.productId);
		await fixture.t.run((ctx) => ctx.db.patch(created.productId, {
			draftRevisionId: created.revisionId,
			publishedRevisionId: middle.revisionId,
			publishedAt: value.updatedAt,
			publishedBy: "fixture",
		}));
		const corrupt = await product(fixture, created.productId);
		const beforeCounts = await storedCounts(fixture);
		const mismatch = /revision slug ownership mismatch/i;
		const reads = [
			() => fixture.adminA.query(api.catalogProductGraphs.getEditorState, {
				productId: created.productId,
			}),
			() => fixture.adminA.query(api.catalogProductGraphs.listForEditor, {
				siteUrl: SITE_A.siteUrl, productKind: "print",
			}),
			() => fixture.t.query(api.catalogProductGraphs.getPublishedBySlug, {
				siteUrl: SITE_A.siteUrl, slug: "integrity-current",
			}),
			() => fixture.adminA.query(api.catalogProductGraphs.getRetirementEligibility, {
				productId: created.productId,
			}),
			() => fixture.adminA.query(api.catalogProductGraphs.listDraftPrivateAssetCandidates, {
				productId: created.productId, expectedDraftRevisionId: created.revisionId,
				relation: { kind: "print_source", relationKey: "master" },
				paginationOpts: { numItems: 1, cursor: null },
			}),
		];
		for (const read of reads) await expect(read()).rejects.toThrow(mismatch);
		await expect(resolve(fixture, checkout(item(
			{ ...created, revisionId: middle.revisionId }, "print",
		)))).rejects.toThrow(mismatch);
		const cas = {
			productId: created.productId,
			expectedDraftRevisionId: created.revisionId,
			expectedPublishedRevisionId: middle.revisionId,
			expectedUpdatedAt: corrupt.updatedAt,
		};
		const mutations = [
			() => saveGraph(fixture.adminA, created.productId,
				graphDraft("print", fixture, "integrity-current"), created.revisionId),
			() => fixture.adminA.mutation(api.catalogProductGraphs.publishDraft, cas),
			() => fixture.adminA.mutation(api.catalogProductGraphs.unpublish, cas),
			() => fixture.adminA.mutation(api.catalogProductGraphs.replaceDraftPrivateAsset, {
				productId: created.productId, expectedDraftRevisionId: created.revisionId,
				relation: { kind: "print_source", relationKey: "master", assetId: fixture.printA2 },
			}),
			() => fixture.adminA.mutation(api.catalogProductGraphs.discardDraft, {
				productId: created.productId, draftRevisionId: created.revisionId,
			}),
		];
		for (const mutation of mutations) await expect(mutation()).rejects.toThrow(mismatch);
		expect(await product(fixture, created.productId)).toEqual(corrupt);
		expect(await storedCounts(fixture)).toEqual(beforeCounts);
		expect((await resolve(fixture, paid("paid_fulfillment"))).identity.revisionId)
			.toBe(created.revisionId);
	});

	test("replays the immutable paid revision after unpublish, re-slug, and current-policy changes", async () => {
		const fixture = await setup(modules);
		const created = await createGraph(
			fixture.adminA, SITE_A.siteUrl, "historical-print",
			graphDraft("print", fixture, "historical-print"),
		);
		await publish(fixture, created);
		await seedOrder(fixture, item(created, "print"));
		const unavailableDraft = graphDraft("print", fixture, "historical-print");
		unavailableDraft.saleAvailability = "unavailable";
		unavailableDraft.variants[0]!.status = "disabled";
		const newer = await saveGraph(
			fixture.adminA, created.productId, unavailableDraft, created.revisionId,
		);
		expect((await resolve(fixture, paid("paid_fulfillment"))).identity.revisionId)
			.toBe(created.revisionId);
		await publish(fixture, { ...created, revisionId: newer.revisionId });
		expect((await resolve(fixture, paid("paid_fulfillment"))).identity.revisionId)
			.toBe(created.revisionId);
		const published = await product(fixture, created.productId);
		await fixture.adminA.mutation(api.catalogProductGraphs.unpublish, {
			productId: created.productId,
			expectedDraftRevisionId: published.draftRevisionId ?? null,
			expectedPublishedRevisionId: published.publishedRevisionId ?? null,
			expectedUpdatedAt: published.updatedAt,
		});
		await saveGraph(fixture.adminA, created.productId, {
			...unavailableDraft, slug: "new-current-slug",
		}, newer.revisionId);
		await fixture.t.run(async (ctx) => {
			const client = await ctx.db.query("platformClients")
				.withIndex("by_siteUrl", (query) => query.eq("siteUrl", SITE_A.siteUrl)).unique();
			if (!client) throw new Error("Missing client fixture");
			await ctx.db.patch(client._id, { catalogProductKinds: [] });
		});
		const replay = await resolve(fixture, paid("paid_fulfillment"));
		if (!("current" in replay)) throw new Error("Paid result lost its current flags");
		expect(replay.identity.slug).toBe("historical-print");
		expect(replay.current).toEqual({
			kindEnabled: false, publishedRevision: false, slugMatches: false,
			available: false, variantEnabled: false,
		});
		expect(await fixture.t.query(api.catalogProductGraphs.getPublishedBySlug, {
			siteUrl: SITE_A.siteUrl, slug: "historical-print",
		})).toBeNull();
		await fixture.t.run(async (ctx) => {
			await ctx.db.patch(created.productId, {
				publishedRevisionId: created.revisionId, publishedAt: Date.now(), publishedBy: "fixture",
			});
			const client = await ctx.db.query("platformClients")
				.withIndex("by_siteUrl", (query) => query.eq("siteUrl", SITE_A.siteUrl)).unique();
			if (!client) throw new Error("Missing client fixture");
			await ctx.db.patch(client._id, { catalogProductKinds: ["print"] });
		});
		await expect(fixture.t.query(api.catalogProductGraphs.getPublishedBySlug, {
			siteUrl: SITE_A.siteUrl, slug: "new-current-slug",
		})).rejects.toThrow(/revision slug ownership mismatch/i);
		expect((await resolve(fixture, paid("paid_fulfillment"))).identity.revisionId)
			.toBe(created.revisionId);
	});
});

describe("catalog commerce HTTP contract", () => {
	test("parses only the exact body for the server-selected purpose", () => {
		const valid = { version: 1, stripeSessionId: SESSION, itemIndex: 0 } as const;
		expect(parseCatalogCommerceRequest(valid, "paid_download")).toEqual(paid("paid_download"));
		expect(parseCatalogCommerceRequest(valid, "paid_fulfillment")).toEqual(paid("paid_fulfillment"));
		expect(parseCatalogCommerceRequest({ ...valid, purpose: "paid_download" }, "paid_download")).toBeNull();
		expect(parseCatalogCommerceRequest({ ...valid, itemIndex: -1 }, "paid_download")).toBeNull();
		expect(parseCatalogCommerceRequest({ ...valid, itemIndex: 40 }, "paid_download")).toBeNull();
		expect(parseCatalogCommerceRequest({ ...valid, stripeSessionId: "candidate" }, "paid_download"))
			.toBeNull();
		expect(parseCatalogCommerceRequest({ ...valid, version: 2 }, "paid_download")).toBeNull();
	});

	test("is purpose-fixed, exact, bounded, no-store, generic, and default closed", async () => {
		const fixture = await setup(modules);
		const created = await createGraph(
			fixture.adminA, SITE_A.siteUrl, "http-print", graphDraft("print", fixture, "http-print"),
		);
		await publish(fixture, created);
		const checkoutBody = JSON.stringify({ version: 1, item: item(created, "print") });
		const paidBody = JSON.stringify({ version: 1, stripeSessionId: SESSION, itemIndex: 0 });
		const send = (path: string = PATHS.checkout, secret = SECRET, body = checkoutBody,
			contentType = "application/json") => fixture.t.fetch(path, {
			method: "POST",
			headers: { Authorization: `Bearer ${secret}`, "Content-Type": contentType },
			body,
		});
		const before = await fixture.t.run((ctx) => ctx.db.query("orders").take(1));
		expect((await fixture.t.fetch(PATHS.checkout, { method: "GET" })).status).toBe(404);
		const ok = await send();
		expect(ok.status).toBe(200);
		expect(ok.headers.get("Cache-Control")).toBe("no-store");
		expect((await ok.json()).descriptor).toBeUndefined();
		expect((await send(PATHS.checkout, "wrong-secret-authority-0123456789abcdef")).status).toBe(401);
		expect((await send(PATHS.checkout, SECRET, checkoutBody, "application/json; charset=utf-8")).status)
			.toBe(400);
		expect((await send(`${PATHS.checkout}?candidate=1`)).status).toBe(400);
		expect((await send(PATHS.checkout, SECRET, JSON.stringify({ padding: "x".repeat(4096) }))).status)
			.toBe(400);

		expect((await send(PATHS.paid_fulfillment, FULFILLMENT_SECRET, paidBody)).status).toBe(404);
		expect((await send(PATHS.paid_download, DOWNLOAD_SECRET, paidBody)).status).toBe(404);
		await seedOrder(fixture, item(created, "print"), SESSION, "refunded");
		expect((await send(PATHS.paid_fulfillment, FULFILLMENT_SECRET, paidBody)).status).toBe(409);
		await fixture.t.run(async (ctx) => {
			const order = await ctx.db.query("orders").withIndex("by_stripeSessionId", (q) => q.eq("stripeSessionId", SESSION)).unique();
			if (order) await ctx.db.delete(order._id);
		});
		expect((await send(PATHS.paid_fulfillment, SECRET, paidBody)).status).toBe(401);
		expect((await send(PATHS.paid_download, FULFILLMENT_SECRET, paidBody)).status).toBe(401);
		expect((await send(PATHS.checkout, DOWNLOAD_SECRET)).status).toBe(401);
		expect((await send(PATHS.checkout, SECRET, JSON.stringify({
			version: 1, purpose: "paid_download", item: item(created, "print"),
		}))).status).toBe(400);

		delete process.env.CATALOG_COMMERCE_CHECKOUT_RESOLVER_SECRETS;
		expect((await send()).status).toBe(503);
		process.env.CATALOG_COMMERCE_CHECKOUT_RESOLVER_SECRETS = JSON.stringify({ [SITE_A.siteUrl]: [SECRET] });
		delete process.env.CATALOG_COMMERCE_PAID_FULFILLMENT_RESOLVER_SECRETS;
		expect((await send(PATHS.paid_fulfillment, FULFILLMENT_SECRET, paidBody)).status).toBe(503);
		process.env.CATALOG_COMMERCE_PAID_FULFILLMENT_RESOLVER_SECRETS = JSON.stringify({
			[SITE_A.siteUrl]: [FULFILLMENT_SECRET],
		});
		delete process.env.CATALOG_COMMERCE_PAID_DOWNLOAD_RESOLVER_SECRETS;
		expect((await send(PATHS.paid_download, DOWNLOAD_SECRET, paidBody)).status).toBe(503);
		process.env.CATALOG_COMMERCE_PAID_DOWNLOAD_RESOLVER_SECRETS = "malformed";
		expect((await send()).status).toBe(503);
		process.env.CATALOG_COMMERCE_PAID_DOWNLOAD_RESOLVER_SECRETS = JSON.stringify({
			[SITE_A.siteUrl]: [SECRET],
		});
		expect((await send()).status).toBe(503);
		process.env.CATALOG_COMMERCE_PAID_DOWNLOAD_RESOLVER_SECRETS = JSON.stringify({
			[SITE_A.siteUrl]: [DOWNLOAD_SECRET],
		});
		process.env.WEBHOOK_SECRET = SECRET;
		expect((await send()).status).toBe(503);
		delete process.env.WEBHOOK_SECRET;
		process.env.CHECKOUT_ROLE_CREDENTIAL_FINGERPRINTS = JSON.stringify({
			checkoutBridge: [await serverSecretFingerprint(SECRET)],
			checkoutSnapshotReservation: ["b".repeat(64)],
		});
		expect((await send()).status).toBe(503);
		expect(await fixture.t.query(api.catalogProductGraphs.getPublishedBySlug, {
			siteUrl: SITE_A.siteUrl, slug: "http-print",
		})).not.toBeNull();
		expect(await fixture.t.run((ctx) => ctx.db.query("orders").take(1))).toEqual(before);
	});
});
