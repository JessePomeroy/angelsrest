import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import {
	internalMutation,
	internalQuery,
	type MutationCtx,
	mutation,
	query,
} from "./_generated/server";
import { requireDocumentSiteAdmin, requireSiteAdmin } from "./authHelpers";
import { requireBlogAssetUnused } from "./helpers/blogContentData";
import {
	type AboutPageDraftPayload,
	aboutPageReferencesAsset,
	type ModelingPageDraftPayload,
	modelingPageReferencesAsset,
} from "./helpers/contentValidators";
import {
	type ReadyWebAsset,
	readyWebAssetValidator,
	validateReadyWebAsset,
} from "./helpers/mediaValidators";
import { POST_CONTENT_LIMITS } from "./helpers/postContentValidators";

const MEDIA_LIBRARY_PAGE_MAX = 100;
const MEDIA_BATCH_MAX = 500;
const IMPORT_TARGET_BATCH_MAX = 21;
const IMPORT_TARGET_DERIVATIVE_FILENAMES = {
	thumb: "thumb.webp",
	card: "card.webp",
	display1280: "display-1280.webp",
	display2048: "display-2048.webp",
	display2560: "display-2560.webp",
} as const;

type ImportTargetDerivativeName = keyof typeof IMPORT_TARGET_DERIVATIVE_FILENAMES;

function projectImportTargetDerivative(
	asset: Doc<"mediaAssets">,
	name: ImportTargetDerivativeName,
	prefix: string,
) {
	const derivative = asset.derivatives[name];
	return {
		identityMatches:
			derivative.key === `${prefix}${IMPORT_TARGET_DERIVATIVE_FILENAMES[name]}`,
		contentType: derivative.contentType,
		width: derivative.width,
		height: derivative.height,
	};
}

function projectImportTarget(asset: Doc<"mediaAssets">) {
	const prefix = `sites/${asset.siteUrl}/web/${asset.assetId}/`;
	return {
		mediaAssetId: asset._id,
		workerAssetId: asset.assetId,
		siteUrl: asset.siteUrl,
		intent: asset.intent,
		status: asset.status,
		source: {
			contentType: asset.source.contentType,
			sizeBytes: asset.source.sizeBytes,
			width: asset.source.width,
			height: asset.source.height,
		},
		masterIdentityMatches: asset.master.key === `${prefix}master.webp`,
		derivatives: {
			thumb: projectImportTargetDerivative(asset, "thumb", prefix),
			card: projectImportTargetDerivative(asset, "card", prefix),
			display1280: projectImportTargetDerivative(asset, "display1280", prefix),
			display2048: projectImportTargetDerivative(asset, "display2048", prefix),
			display2560: projectImportTargetDerivative(asset, "display2560", prefix),
		},
	};
}

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

async function requireAssetUnused(
	ctx: MutationCtx,
	asset: Doc<"mediaAssets">,
) {
	const postDocuments = await ctx.db
		.query("contentDocuments")
		.withIndex("by_siteUrl_and_kind_and_rank", (q) =>
			q.eq("siteUrl", asset.siteUrl).eq("kind", "post"),
		)
		.take(POST_CONTENT_LIMITS.documents + 1);
	if (postDocuments.length > POST_CONTENT_LIMITS.documents) {
		throw new Error("Media asset Post usage cannot be verified safely");
	}
	const activeRevisionIds = [
		...new Set(
			postDocuments.flatMap((document) =>
				[document.draftRevisionId, document.publishedRevisionId].filter(
					(revisionId): revisionId is NonNullable<typeof revisionId> =>
						revisionId !== undefined,
				),
			),
		),
	];
	const activePostUsages = await Promise.all(
		activeRevisionIds.map(async (revisionId) =>
			await ctx.db
				.query("contentMediaPlacements")
				.withIndex("by_revisionId_and_assetId", (q) =>
					q.eq("revisionId", revisionId).eq("assetId", asset._id),
				)
				.first(),
		),
	);
	if (activePostUsages.some((usage) => usage !== null)) {
		throw new Error("Media asset is in use by Post content");
	}

	const portfolioUsage = await ctx.db
		.query("portfolioPlacements")
		.withIndex("by_siteUrl_and_assetId", (q) =>
			q.eq("siteUrl", asset.siteUrl).eq("assetId", asset._id),
		)
		.first();
	if (portfolioUsage) throw new Error("Media asset is in use by portfolio content");

	const catalogUsage = await ctx.db
		.query("catalogProductMediaPlacements")
		.withIndex("by_siteUrl_and_assetId", (q) =>
			q.eq("siteUrl", asset.siteUrl).eq("assetId", asset._id),
		)
		.first();
	if (catalogUsage) throw new Error("Media asset is in use by catalog content");

	const aboutDocument = await ctx.db
		.query("contentDocuments")
		.withIndex("by_siteUrl_and_kind", (q) =>
			q.eq("siteUrl", asset.siteUrl).eq("kind", "aboutPage"),
		)
		.unique();
	if (aboutDocument) {
		const revisionIds = [
			aboutDocument.draftRevisionId,
			aboutDocument.publishedRevisionId,
		].filter((id): id is NonNullable<typeof id> => id !== undefined);
		const revisions = await Promise.all(
			[...new Set(revisionIds)].map((revisionId) => ctx.db.get(revisionId)),
		);
		for (const revision of revisions) {
			if (
				revision
				&& revision.documentId === aboutDocument._id
				&& revision.siteUrl === asset.siteUrl
				&& revision.kind === "aboutPage"
				&& aboutPageReferencesAsset(
					revision.payload as AboutPageDraftPayload,
					asset._id,
				)
			) throw new Error("Media asset is in use by About content");
		}
	}

	const modelingDocument = await ctx.db
		.query("contentDocuments")
		.withIndex("by_siteUrl_and_kind", (q) =>
			q.eq("siteUrl", asset.siteUrl).eq("kind", "modelingPage"),
		)
		.unique();
	if (modelingDocument) {
		const revisionIds = [
			modelingDocument.draftRevisionId,
			modelingDocument.publishedRevisionId,
		].filter((id): id is NonNullable<typeof id> => id !== undefined);
		const revisions = await Promise.all(
			[...new Set(revisionIds)].map((revisionId) => ctx.db.get(revisionId)),
		);
		for (const revision of revisions) {
			if (
				revision
				&& revision.documentId === modelingDocument._id
				&& revision.siteUrl === asset.siteUrl
				&& revision.kind === "modelingPage"
				&& modelingPageReferencesAsset(
					revision.payload as ModelingPageDraftPayload,
					asset._id,
				)
			) throw new Error("Media asset is in use by Modeling content");
		}
	}

	await requireBlogAssetUnused(ctx, asset);
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
		const deletionTombstone = await ctx.db
			.query("mediaAssetDeletionTombstones")
			.withIndex("by_siteUrl_and_assetId", (q) =>
				q.eq("siteUrl", client.siteUrl).eq("assetId", asset.assetId),
			)
			.unique();
		if (deletionTombstone) {
			throw new Error("Media asset was permanently deleted");
		}
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

export const verifyImportTargets = internalQuery({
	args: {
		expectedSiteUrl: v.string(),
		ids: v.array(v.id("mediaAssets")),
	},
	handler: async (ctx, { expectedSiteUrl, ids }) => {
		if (
			expectedSiteUrl.length === 0
			|| expectedSiteUrl !== expectedSiteUrl.trim()
		) throw new Error("Expected import target site URL is invalid");
		if (ids.length > IMPORT_TARGET_BATCH_MAX) {
			throw new Error(
				`Import target verification cannot exceed ${IMPORT_TARGET_BATCH_MAX} assets`,
			);
		}
		if (new Set(ids).size !== ids.length) {
			throw new Error("Import target verification requires unique assets");
		}

		const assets = await Promise.all(ids.map((id) => ctx.db.get(id)));
		return assets.map((asset) => {
			if (!asset) throw new Error("Media import target not found");
			if (asset.siteUrl !== expectedSiteUrl) {
				throw new Error("Media import target does not belong to expected site");
			}
			return projectImportTarget(asset);
		});
	},
});

export const requestDeletion = mutation({
	args: { siteUrl: v.string(), id: v.id("mediaAssets") },
	handler: async (ctx, { siteUrl, id }) => {
		const { identity, client } = await requireSiteAdmin(ctx, siteUrl);
		const asset = await ctx.db.get(id);
		if (!asset) {
			const completed = await ctx.db
				.query("mediaAssetDeletionTombstones")
				.withIndex("by_siteUrl_and_mediaAssetId", (q) =>
					q.eq("siteUrl", client.siteUrl).eq("mediaAssetId", id),
				)
				.unique();
			if (!completed) throw new Error("Media asset not found");
			return {
				status: "deleted" as const,
				siteUrl: completed.siteUrl,
				assetId: completed.assetId,
				privateKeys: completed.privateKeys,
				publicKeys: completed.publicKeys,
			};
		}
		if (asset.siteUrl !== client.siteUrl) {
			throw new Error("Media asset not found");
		}
		await requireAssetUnused(ctx, asset);
		if (asset.status === "deleting") {
			return {
				status: asset.status,
				siteUrl: asset.siteUrl,
				assetId: asset.assetId,
				...cleanupManifest(asset),
			};
		}

		const now = Date.now();
		await ctx.db.patch(id, {
			status: "deleting",
			deletionRequestedAt: now,
			deletionRequestedBy: identity.tokenIdentifier,
			updatedAt: now,
			updatedBy: identity.tokenIdentifier,
		});
		return {
			status: "deleting" as const,
			siteUrl: asset.siteUrl,
			assetId: asset.assetId,
			...cleanupManifest(asset),
		};
	},
});

export const completeDeletion = internalMutation({
	args: {
		siteUrl: v.string(),
		id: v.id("mediaAssets"),
		assetId: v.string(),
	},
	handler: async (ctx, { siteUrl, id, assetId }) => {
		const completed = await ctx.db
			.query("mediaAssetDeletionTombstones")
			.withIndex("by_siteUrl_and_assetId", (q) =>
				q.eq("siteUrl", siteUrl).eq("assetId", assetId),
			)
			.unique();
		if (completed) {
			if (completed.mediaAssetId !== id) {
				throw new Error("Media asset deletion identity conflict");
			}
			return { deleted: true, alreadyDeleted: true };
		}
		const asset = await ctx.db.get(id);
		if (!asset || asset.siteUrl !== siteUrl || asset.assetId !== assetId) {
			throw new Error("Media asset not found");
		}
		if (asset.status !== "deleting") {
			throw new Error("Media asset deletion has not been requested");
		}
		await requireAssetUnused(ctx, asset);
		const manifest = cleanupManifest(asset);
		await ctx.db.insert("mediaAssetDeletionTombstones", {
			siteUrl: asset.siteUrl,
			assetId: asset.assetId,
			mediaAssetId: asset._id,
			...manifest,
			deletedAt: Date.now(),
			deletionRequestedAt: asset.deletionRequestedAt,
			deletionRequestedBy: asset.deletionRequestedBy,
		});
		await ctx.db.delete(id);
		return { deleted: true, alreadyDeleted: false };
	},
});
