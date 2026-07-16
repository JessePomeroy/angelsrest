import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireDocumentSiteAdmin, requireSiteAdmin } from "./authHelpers";
import {
	readyWebAssetValidator,
	validateReadyWebAsset,
	type ReadyWebAsset,
} from "./helpers/mediaValidators";

const MEDIA_LIBRARY_PAGE_MAX = 100;
const MEDIA_BATCH_MAX = 500;

function projectEditorAsset(asset: {
	_id: string;
	assetId: string;
	originalFilename: string;
	status: "ready" | "deleting";
	source: ReadyWebAsset["source"];
	derivatives: ReadyWebAsset["derivatives"];
	createdAt: number;
}) {
	return {
		_id: asset._id,
		assetId: asset.assetId,
		originalFilename: asset.originalFilename,
		status: asset.status,
		source: asset.source,
		derivatives: asset.derivatives,
		createdAt: asset.createdAt,
	};
}

function projectAssetRegistration(asset: ReadyWebAsset) {
	return {
		assetId: asset.assetId,
		originalFilename: asset.originalFilename,
		source: {
			contentType: asset.source.contentType,
			sizeBytes: asset.source.sizeBytes,
			width: asset.source.width,
			height: asset.source.height,
		},
		master: {
			key: asset.master.key,
			contentType: asset.master.contentType,
			sizeBytes: asset.master.sizeBytes,
			width: asset.master.width,
			height: asset.master.height,
		},
		derivatives: {
			thumb: { ...asset.derivatives.thumb },
			card: { ...asset.derivatives.card },
			display1280: { ...asset.derivatives.display1280 },
			display2048: { ...asset.derivatives.display2048 },
			display2560: { ...asset.derivatives.display2560 },
		},
	};
}

function storedRegistration(asset: {
	assetId: string;
	originalFilename: string;
	source: ReadyWebAsset["source"];
	master: ReadyWebAsset["master"];
	derivatives: ReadyWebAsset["derivatives"];
}) {
	return projectAssetRegistration(asset);
}

function cleanupManifest(asset: {
	master: ReadyWebAsset["master"];
	derivatives: ReadyWebAsset["derivatives"];
}) {
	return {
		privateKeys: [asset.master.key],
		publicKeys: [
			asset.derivatives.thumb.key,
			asset.derivatives.card.key,
			asset.derivatives.display1280.key,
			asset.derivatives.display2048.key,
			asset.derivatives.display2560.key,
		],
	};
}

export const registerReadyWebAsset = mutation({
	args: {
		siteUrl: v.string(),
		asset: readyWebAssetValidator,
	},
	handler: async (ctx, { siteUrl, asset }) => {
		const { identity, client } = await requireSiteAdmin(ctx, siteUrl);
		validateReadyWebAsset(client.siteUrl, asset);
		const existing = await ctx.db
			.query("mediaAssets")
			.withIndex("by_siteUrl_and_assetId", (q) =>
				q.eq("siteUrl", client.siteUrl).eq("assetId", asset.assetId),
			)
			.unique();
		if (existing) {
			if (
				JSON.stringify(storedRegistration(existing))
				!== JSON.stringify(projectAssetRegistration(asset))
			) throw new Error("Media asset registration conflict");
			return { id: existing._id, status: existing.status };
		}

		const now = Date.now();
		const actor = identity.tokenIdentifier;
		const id = await ctx.db.insert("mediaAssets", {
			siteUrl: client.siteUrl,
			intent: "web",
			status: "ready",
			...asset,
			createdAt: now,
			createdBy: actor,
			updatedAt: now,
			updatedBy: actor,
		});
		return { id, status: "ready" as const };
	},
});

export const get = query({
	args: { id: v.id("mediaAssets") },
	handler: async (ctx, { id }) => {
		return await requireDocumentSiteAdmin(ctx, "mediaAssets", id);
	},
});

export const listBySite = query({
	args: {
		siteUrl: v.string(),
		paginationOpts: paginationOptsValidator,
	},
	handler: async (ctx, { siteUrl, paginationOpts }) => {
		const { client } = await requireSiteAdmin(ctx, siteUrl);
		if (
			!Number.isSafeInteger(paginationOpts.numItems)
			|| paginationOpts.numItems < 1
			|| paginationOpts.numItems > MEDIA_LIBRARY_PAGE_MAX
		) throw new Error(`Media library pages cannot exceed ${MEDIA_LIBRARY_PAGE_MAX} items`);
		return await ctx.db
			.query("mediaAssets")
			.withIndex("by_siteUrl_and_createdAt", (q) => q.eq("siteUrl", client.siteUrl))
			.order("desc")
			.paginate(paginationOpts);
	},
});

export const listForEditor = query({
	args: {
		siteUrl: v.string(),
		paginationOpts: paginationOptsValidator,
	},
	handler: async (ctx, { siteUrl, paginationOpts }) => {
		const { client } = await requireSiteAdmin(ctx, siteUrl);
		if (
			!Number.isSafeInteger(paginationOpts.numItems)
			|| paginationOpts.numItems < 1
			|| paginationOpts.numItems > MEDIA_LIBRARY_PAGE_MAX
		) throw new Error(`Media library pages cannot exceed ${MEDIA_LIBRARY_PAGE_MAX} items`);
		const result = await ctx.db
			.query("mediaAssets")
			.withIndex("by_siteUrl_and_createdAt", (q) => q.eq("siteUrl", client.siteUrl))
			.order("desc")
			.paginate(paginationOpts);
		return { ...result, page: result.page.map(projectEditorAsset) };
	},
});

export const getManyForEditor = query({
	args: {
		siteUrl: v.string(),
		ids: v.array(v.id("mediaAssets")),
	},
	handler: async (ctx, { siteUrl, ids }) => {
		const { client } = await requireSiteAdmin(ctx, siteUrl);
		if (ids.length > MEDIA_BATCH_MAX || new Set(ids).size !== ids.length) {
			throw new Error(`Media batches must contain at most ${MEDIA_BATCH_MAX} unique assets`);
		}
		const assets = await Promise.all(ids.map((id) => ctx.db.get(id)));
		return assets.map((asset) => {
			if (!asset || asset.siteUrl !== client.siteUrl) {
				throw new Error("Media asset not found");
			}
			return projectEditorAsset(asset);
		});
	},
});

export const requestDeletion = mutation({
	args: { id: v.id("mediaAssets") },
	handler: async (ctx, { id }) => {
		const asset = await requireDocumentSiteAdmin(ctx, "mediaAssets", id);
		const usage = await ctx.db
			.query("portfolioPlacements")
			.withIndex("by_siteUrl_and_assetId", (q) =>
				q.eq("siteUrl", asset.siteUrl).eq("assetId", id),
			)
			.first();
		if (usage) throw new Error("Media asset is in use by portfolio content");
		if (asset.status === "deleting") {
			return { status: asset.status, ...cleanupManifest(asset) };
		}

		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Not authenticated");
		const now = Date.now();
		await ctx.db.patch(id, {
			status: "deleting",
			deletionRequestedAt: now,
			deletionRequestedBy: identity.tokenIdentifier,
			updatedAt: now,
			updatedBy: identity.tokenIdentifier,
		});
		return { status: "deleting" as const, ...cleanupManifest(asset) };
	},
});

export const completeDeletion = mutation({
	args: { id: v.id("mediaAssets") },
	handler: async (ctx, { id }) => {
		const asset = await requireDocumentSiteAdmin(ctx, "mediaAssets", id);
		if (asset.status !== "deleting") {
			throw new Error("Media asset deletion has not been requested");
		}
		const usage = await ctx.db
			.query("portfolioPlacements")
			.withIndex("by_siteUrl_and_assetId", (q) =>
				q.eq("siteUrl", asset.siteUrl).eq("assetId", id),
			)
			.first();
		if (usage) throw new Error("Media asset is in use by portfolio content");
		await ctx.db.delete(id);
		return { deleted: true };
	},
});
