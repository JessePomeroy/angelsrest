import {
	canonicalPortfolioJson,
	digestPortfolioMigrationPlan,
	type PortfolioMigrationPlan,
	validatePortfolioMigrationPlan,
} from "../../../../packages/crm-api/convex/helpers/portfolioMigrationPlan";
import {
	type PortfolioMediaReceiptSet,
	parsePortfolioMediaReceiptSet,
} from "./portfolioMediaTransfer";
import {
	createPortfolioMediaTransferPlan,
	PORTFOLIO_DECISION_SET,
	PORTFOLIO_MEDIA_TRANSFORM_RECIPE,
	type PortfolioInventoryFiles,
	type PortfolioMediaTransferPlan,
	type PortfolioPreservedTargetFiles,
} from "./portfolioMediaTransferPlan";

type JsonObject = Record<string, unknown>;

function objectValue(value: unknown, label: string): JsonObject {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${label} must be an object`);
	}
	return value as JsonObject;
}

function arrayValue(value: unknown, label: string): unknown[] {
	if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
	return value;
}

function stringValue(value: unknown, label: string): string {
	if (typeof value !== "string" || !value || value !== value.trim()) {
		throw new Error(`${label} must be a non-empty trimmed string`);
	}
	return value;
}

function optionalString(value: unknown, label: string): string | undefined {
	if (value === null || value === undefined) return undefined;
	return stringValue(value, label);
}

function parseMappingCandidates(files: PortfolioInventoryFiles) {
	try {
		return objectValue(
			JSON.parse(files["MAPPING-CANDIDATES.json"]) as unknown,
			"Portfolio mapping candidates",
		);
	} catch (error) {
		if (error instanceof SyntaxError)
			throw new Error("Portfolio mapping candidates are invalid JSON");
		throw error;
	}
}

function exactTransferPlan(
	files: PortfolioInventoryFiles,
	preservedTargetFiles: PortfolioPreservedTargetFiles,
	provided: PortfolioMediaTransferPlan,
) {
	const expected = createPortfolioMediaTransferPlan(files, preservedTargetFiles);
	if (canonicalPortfolioJson(expected) !== canonicalPortfolioJson(provided)) {
		throw new Error("Portfolio media transfer plan differs from the sealed inventory");
	}
	return expected;
}

export async function createPortfolioMigrationPlanFromReceipts({
	files,
	preservedTargetFiles,
	transferPlan,
	receiptSet,
}: {
	files: PortfolioInventoryFiles;
	preservedTargetFiles: PortfolioPreservedTargetFiles;
	transferPlan: PortfolioMediaTransferPlan;
	receiptSet: PortfolioMediaReceiptSet;
}) {
	const plan = exactTransferPlan(files, preservedTargetFiles, transferPlan);
	const receipts = parsePortfolioMediaReceiptSet(receiptSet, plan);
	const mappings = parseMappingCandidates(files);
	const receiptByRef = new Map(
		receipts.receipts.map((receipt) => [receipt.sourceAsset.id, receipt]),
	);

	const mediaMappings: PortfolioMigrationPlan["mediaMappings"] = plan.assets.map((asset) => {
		const receipt = receiptByRef.get(asset.sourceAsset.id);
		if (!receipt) throw new Error("Portfolio media receipt mapping is incomplete");
		const cardAnimation = receipt.target.publicDerivatives.card.animation;
		const display2048Animation = receipt.target.publicDerivatives.display2048.animation;
		if ((cardAnimation === undefined) !== (display2048Animation === undefined)) {
			throw new Error("Portfolio target animation evidence is incomplete");
		}
		return {
			sourceAssetRef: asset.sourceAsset.id,
			sourceAssetRevision: asset.sourceAsset.revision,
			sourceOriginalContentType: asset.sourceAsset.originalContentType,
			transferRecipe: PORTFOLIO_MEDIA_TRANSFORM_RECIPE,
			transferSha256: receipt.transferSource.sha256,
			transferSizeBytes: receipt.transferSource.sizeBytes,
			transferWidth: receipt.transferSource.width,
			transferHeight: receipt.transferSource.height,
			targetMediaAssetId: receipt.target
				.mediaAssetId as PortfolioMigrationPlan["mediaMappings"][number]["targetMediaAssetId"],
			targetWorkerAssetId: receipt.target.workerAssetId,
			targetReceiptSha256: receipt.receiptDigest,
			...(cardAnimation && display2048Animation
				? {
						targetAnimationInspection: {
							card: cardAnimation,
							display2048: display2048Animation,
						},
					}
				: {}),
		};
	});

	const mappingRows = arrayValue(mappings.mappings, "Portfolio gallery mappings");
	const entries: PortfolioMigrationPlan["entries"] = mappingRows.map((mappingValue, index) => {
		const mapping = objectValue(mappingValue, "Portfolio gallery mapping");
		const source = objectValue(mapping.source, "Portfolio gallery source");
		const candidate = objectValue(mapping.targetCandidate, "Portfolio gallery target candidate");
		if (candidate.portfolioOrder !== index) {
			throw new Error("Portfolio gallery target order changed");
		}
		const placements = arrayValue(candidate.placements, "Portfolio gallery placements").map(
			(placementValue, placementIndex) => {
				const placement = objectValue(placementValue, "Portfolio gallery placement");
				const sourceAssetRef = stringValue(
					placement.sourceAssetRef,
					"Portfolio placement source asset",
				);
				const receipt = receiptByRef.get(sourceAssetRef);
				if (!receipt || placement.order !== placementIndex || placement.caption !== null) {
					throw new Error("Portfolio placement mapping differs from the reviewed source order");
				}
				const altText = optionalString(placement.alt, "Portfolio source alt text");
				const focalPoint = placement.focalPointCandidate;
				if (
					focalPoint !== null &&
					(!focalPoint || typeof focalPoint !== "object" || Array.isArray(focalPoint))
				) {
					throw new Error("Portfolio focal point candidate is invalid");
				}
				return {
					key: stringValue(placement.targetPlacementKeyCandidate, "Portfolio target placement key"),
					assetId: receipt.target
						.mediaAssetId as PortfolioMigrationPlan["entries"][number]["draft"]["placements"][number]["assetId"],
					...(altText ? { altText } : {}),
					sourceAltState: altText ? ("present" as const) : ("absent" as const),
					...(focalPoint ? { focalPoint: focalPoint as { x: number; y: number } } : {}),
					sourceAssetRef,
					sourceCropCanonical: canonicalPortfolioJson(placement.crop),
					sourceHotspotCanonical: canonicalPortfolioJson(placement.hotspot),
				};
			},
		);
		return {
			sourceId: stringValue(source.canonicalId, "Portfolio source gallery ID"),
			sourceRevision: stringValue(source.publishedRevision, "Portfolio source gallery revision"),
			sourceOrderRank: stringValue(source.orderRank, "Portfolio source order rank"),
			sourceUnsupportedCanonical: canonicalPortfolioJson(mapping.unsupportedSourceValues),
			targetIsVisible: true,
			portfolioOrder: index,
			draft: {
				title: stringValue(candidate.title, "Portfolio target title"),
				...(optionalString(candidate.description, "Portfolio target description")
					? {
							description: optionalString(candidate.description, "Portfolio target description"),
						}
					: {}),
				slug: stringValue(candidate.slug, "Portfolio target slug"),
				placements,
			},
		};
	});

	const migrationPlan: PortfolioMigrationPlan = {
		version: 1,
		migrationId: "angelsrest-r6-portfolio-v1",
		siteUrl: "angelsrest.online",
		source: {
			projectId: "n7rvza4g",
			dataset: "production",
			perspective: "published",
		},
		decisionSet: PORTFOLIO_DECISION_SET,
		preservedTargetGallery: {
			galleryId: plan.preservation.preservedTargetGallery
				.galleryId as PortfolioMigrationPlan["preservedTargetGallery"]["galleryId"],
			draftRevisionId: plan.preservation.preservedTargetGallery
				.draftRevisionId as PortfolioMigrationPlan["preservedTargetGallery"]["draftRevisionId"],
			publishedRevisionId: plan.preservation.preservedTargetGallery.publishedRevisionId,
			slug: plan.preservation.preservedTargetGallery.slug,
			portfolioOrder: plan.preservation.preservedTargetGallery.portfolioOrder,
			isPublished: plan.preservation.preservedTargetGallery.isPublished,
			isVisible: plan.preservation.preservedTargetGallery.isVisible,
			sourceDocumentId: plan.preservation.preservedTargetGallery.sourceDocumentId,
			createdAt: plan.preservation.preservedTargetGallery.createdAt,
			createdByDigest: plan.preservation.preservedTargetGallery.createdByDigest,
			updatedAt: plan.preservation.preservedTargetGallery.updatedAt,
			updatedByDigest: plan.preservation.preservedTargetGallery.updatedByDigest,
			publishedAt: plan.preservation.preservedTargetGallery.publishedAt,
			publishedBy: plan.preservation.preservedTargetGallery.publishedBy,
			revision: {
				revisionId: plan.preservation.preservedTargetGallery.revision
					.revisionId as PortfolioMigrationPlan["preservedTargetGallery"]["revision"]["revisionId"],
				checksum: plan.preservation.preservedTargetGallery.revision.checksum,
				createdAt: plan.preservation.preservedTargetGallery.revision.createdAt,
				createdByDigest: plan.preservation.preservedTargetGallery.revision.createdByDigest,
			},
		},
		mediaMappings,
		entries,
	};
	const counts = validatePortfolioMigrationPlan(migrationPlan);
	const digest = await digestPortfolioMigrationPlan(migrationPlan);
	return { plan: migrationPlan, digest, counts };
}
