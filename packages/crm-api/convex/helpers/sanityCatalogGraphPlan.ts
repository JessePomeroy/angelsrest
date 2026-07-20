import type { Id } from "../_generated/dataModel";
import {
	canonicalizeCatalogProductGraphV2Draft,
	checksumCatalogProductGraphV2Draft,
} from "./catalogProductGraphChecksum";
import { PRIVATE_CATALOG_ASSET_LIMITS } from "./catalogPrivateAssetValidators";
import {
	type CatalogProductGraphV2Draft,
	validateCatalogProductGraphV2Draft,
} from "./catalogProductGraphValidators";
import {
	createSanityCatalogImportDryRunReport,
	type SanityCatalogImportManifest,
	type SanityCatalogImportProduct,
} from "./sanityCatalogImport";
import {
	SANITY_CATALOG_SOURCE_TYPE_BY_KIND,
	type SanityCatalogV2GraphPlan,
	type SanityCatalogV2GraphPlanPayload,
	type SanityCatalogV2TargetIdMaps,
} from "./sanityCatalogGraphPlanContract";
import {
	assertSanityCatalogV2GraphPlan,
	checksumSanityCatalogV2GraphPlan,
} from "./sanityCatalogGraphPlanIntegrity";

export {
	SANITY_CATALOG_SOURCE_TYPE_BY_KIND,
	sanityCatalogV2GraphPlanValidator,
} from "./sanityCatalogGraphPlanContract";
export type {
	SanityCatalogV2GraphPlan,
	SanityCatalogV2GraphPlanPayload,
	SanityCatalogV2TargetIdMaps,
} from "./sanityCatalogGraphPlanContract";
export {
	assertSanityCatalogV2GraphPlan,
	canonicalSanityCatalogV2GraphPlan,
	checksumSanityCatalogV2GraphPlan,
} from "./sanityCatalogGraphPlanIntegrity";

function compareOrdinal(left: string, right: string) {
	return left < right ? -1 : left > right ? 1 : 0;
}

function assertExactStrings(
	actual: readonly string[],
	expected: readonly string[],
	label: string,
) {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(`${label} must exactly match the source manifest`);
	}
}

function assertUnique(values: readonly string[], label: string) {
	if (new Set(values).size !== values.length) throw new Error(`${label} must be unique`);
}

function exactTargetMap<Entry, TargetId extends string>(
	entries: readonly Entry[],
	requiredRefs: readonly string[],
	sourceRefFrom: (entry: Entry) => string,
	targetIdFrom: (entry: Entry) => TargetId,
	label: string,
) {
	const mappings = entries
		.map((entry) => ({
			sourceRef: sourceRefFrom(entry),
			targetId: targetIdFrom(entry),
		}))
		.sort((left, right) => compareOrdinal(left.sourceRef, right.sourceRef));
	const sourceRefs = mappings.map(({ sourceRef }) => sourceRef);
	const targetIds = mappings.map(({ targetId }) => targetId);
	for (const sourceRef of sourceRefs) {
		if (!sourceRef || sourceRef !== sourceRef.trim()) {
			throw new Error(`${label} source mapping is invalid`);
		}
	}
	for (const targetId of targetIds) {
		if (!targetId || targetId !== targetId.trim()) {
			throw new Error(`${label} target mapping is invalid`);
		}
	}
	assertUnique(sourceRefs, `${label} source mappings`);
	assertUnique(targetIds, `${label} target IDs`);
	assertExactStrings(
		sourceRefs,
		[...requiredRefs].sort(compareOrdinal),
		`${label} mapping keys`,
	);
	return {
		mappings,
		byRef: new Map(mappings.map(({ sourceRef, targetId }) => [sourceRef, targetId])),
	};
}

type TargetLookups = {
	webMedia: ReadonlyMap<string, Id<"mediaAssets">>;
	printSources: ReadonlyMap<string, Id<"catalogPrintSourceAssets">>;
	paidFiles: ReadonlyMap<string, Id<"catalogDigitalFileAssets">>;
};

function requireMapping<T extends string>(
	mapping: ReadonlyMap<string, T>,
	sourceRef: string,
	label: string,
) {
	const targetId = mapping.get(sourceRef);
	if (!targetId) throw new Error(`Missing ${label} mapping for ${sourceRef}`);
	return targetId;
}

function commonDraft(product: SanityCatalogImportProduct, targets: TargetLookups) {
	return {
		schemaVersion: 2 as const,
		...(product.title === undefined ? {} : { title: product.title }),
		...(product.slug === undefined ? {} : { slug: product.slug }),
		...(product.description === undefined ? {} : { description: product.description }),
		...(product.seoDescription === undefined
			? {}
			: { seoDescription: product.seoDescription }),
		currency: "usd" as const,
		saleAvailability: product.saleAvailability,
		shopPlacement: {
			featured: product.shopPlacement.featured,
			...(product.shopPlacement.orderRank === undefined
				? {}
				: { orderRank: product.shopPlacement.orderRank }),
		},
		variants: product.variants.map((variant, order) => ({
			key: variant.key,
			order,
			...(variant.materialOptionKey === undefined
				? {}
				: { materialOptionKey: variant.materialOptionKey }),
			...(variant.sizeOptionKey === undefined
				? {}
				: { sizeOptionKey: variant.sizeOptionKey }),
			...(variant.retailPriceCents === undefined
				? {}
				: { retailPriceCents: variant.retailPriceCents }),
			status: variant.status,
		})),
		webMedia: product.media.map((placement) => ({
			key: placement.key,
			order: placement.order,
			role: placement.role,
			assetId: requireMapping(
				targets.webMedia,
				placement.sourceAssetRef,
				"Web media",
			),
			...(placement.altText === undefined ? {} : { altText: placement.altText }),
		})),
	};
}

function requirePrintOptions(product: SanityCatalogImportProduct) {
	if (!product.printOptions) {
		throw new Error(`Catalog product ${product.productKey} has no print options`);
	}
	return product.printOptions;
}

function validateDigitalSourceCompatibility(product: SanityCatalogImportProduct) {
	const file = product.digitalFile;
	if (!file) throw new Error(`Digital product ${product.productKey} has no paid ZIP source`);
	if (file.mimeType !== "application/zip") {
		throw new Error(`Digital product ${product.productKey} paid source must be application/zip`);
	}
	if (!file.originalFilename.toLowerCase().endsWith(".zip")) {
		throw new Error(`Digital product ${product.productKey} paid source must use a .zip filename`);
	}
	if (
		!Number.isSafeInteger(file.sizeBytes)
		|| file.sizeBytes <= 0
		|| file.sizeBytes > PRIVATE_CATALOG_ASSET_LIMITS.paidDigitalFileSizeBytes
	) throw new Error(`Digital product ${product.productKey} paid source size is unsupported`);
	if (
		file.version !== undefined
		&& (
			!file.version
			|| file.version !== file.version.trim()
			|| file.version.length > PRIVATE_CATALOG_ASSET_LIMITS.digitalFileVersion
		)
	) throw new Error(`Digital product ${product.productKey} paid source version is unsupported`);
	return file;
}

function validateSourceGraphCompleteness(product: SanityCatalogImportProduct) {
	if (product.sourceCollectionId !== undefined) {
		throw new Error(`Catalog product ${product.productKey} still has an unsupported collection`);
	}
	const hasPrintFields = product.printOptions !== undefined
		|| product.printSetMembers !== undefined;
	if (product.kind === "print") {
		if (product.printSetMembers !== undefined || product.digitalFile !== undefined) {
			throw new Error(`Catalog print ${product.productKey} has kind-inapplicable fields`);
		}
		const [primary] = product.media;
		if (
			product.media.length !== 1
			|| !primary
			|| primary.role !== "primary"
			|| primary.order !== 0
			|| !primary.printSource
		) throw new Error(`Catalog print ${product.productKey} needs one exact primary print source`);
		return;
	}
	if (product.kind === "print_set") {
		if (product.digitalFile !== undefined) {
			throw new Error(`Catalog set ${product.productKey} has kind-inapplicable fields`);
		}
		const members = product.printSetMembers;
		if (!members || members.length < 1) {
			throw new Error(`Catalog set ${product.productKey} needs at least one exact member`);
		}
		const covers = product.media.filter(({ role }) => role === "cover");
		if (
			covers.length > 1
			|| covers.some(({ order, printSource }) => order !== 0 || printSource)
			|| product.media.some(({ role }) => role !== "cover" && role !== "set_member")
		) throw new Error(`Catalog set ${product.productKey} has an invalid optional cover`);
		const memberMedia = product.media.filter(({ role }) => role === "set_member");
		if (memberMedia.length !== members.length) {
			throw new Error(`Catalog set ${product.productKey} has an incomplete member graph`);
		}
		for (const member of members) {
			const placement = memberMedia.find(({ key }) => key === member.mediaPlacementKey);
			if (
				!placement
				|| placement.key !== member.key
				|| placement.order !== member.order
				|| !placement.printSource
				|| placement.sourceAssetRef !== member.sourceAssetRef
			) throw new Error(`Catalog set ${product.productKey} has an invalid exact member relation`);
		}
		return;
	}
	if (hasPrintFields) {
		throw new Error(`Catalog product ${product.productKey} has kind-inapplicable print fields`);
	}
	if (product.kind === "digital_download") {
		validateDigitalSourceCompatibility(product);
	} else if (product.digitalFile !== undefined) {
		throw new Error(`Catalog product ${product.productKey} has a kind-inapplicable paid file`);
	}
	if (
		!product.media.some(({ role }) => role === "gallery")
		|| product.media.some(({ role, printSource }) =>
			(role !== "gallery" && role !== "social_share") || printSource
		)
	) throw new Error(`Catalog product ${product.productKey} needs a valid display gallery`);
}

function orderedPrintSources(product: SanityCatalogImportProduct, targets: TargetLookups) {
	return product.media
		.filter((placement) => placement.printSource)
		.sort((left, right) => left.order - right.order || compareOrdinal(left.key, right.key))
		.map((placement) => ({
			key: placement.key,
			order: placement.order,
			assetId: requireMapping(
				targets.printSources,
				placement.sourceAssetRef,
				"Print source",
			),
		}));
}

function draftFromProduct(
	product: SanityCatalogImportProduct,
	targets: TargetLookups,
): CatalogProductGraphV2Draft {
	const common = commonDraft(product, targets);
	if (product.kind === "print") {
		if (
			product.sourceType !== "lumaProductV2"
			|| product.fulfillmentMode !== "production_partner"
		) throw new Error(`Catalog print ${product.productKey} uses an unsupported source contract`);
		return canonicalizeCatalogProductGraphV2Draft({
			...common,
			productKind: "print",
			fulfillmentMode: "production_partner",
			printOptions: requirePrintOptions(product),
			printSources: orderedPrintSources(product, targets),
		});
	}
	if (product.kind === "print_set") {
		if (
			product.sourceType !== "lumaPrintSetV2"
			|| product.fulfillmentMode !== "production_partner"
		) throw new Error(`Catalog set ${product.productKey} uses an unsupported source contract`);
		const printSources = orderedPrintSources(product, targets);
		if (!product.printSetMembers) {
			throw new Error(`Catalog set ${product.productKey} has no member contract`);
		}
		return canonicalizeCatalogProductGraphV2Draft({
			...common,
			productKind: "print_set",
			fulfillmentMode: "production_partner",
			printOptions: requirePrintOptions(product),
			printSources,
			setMembers: [...product.printSetMembers]
				.sort((left, right) => left.order - right.order || compareOrdinal(left.key, right.key))
				.map((member) => {
					const source = printSources.find(
						(item) => item.key === member.mediaPlacementKey && item.order === member.order,
					);
					if (!source) {
						throw new Error(`Catalog set ${product.productKey} has an unresolved member source`);
					}
					return {
						key: member.key,
						order: member.order,
						mediaPlacementKey: member.mediaPlacementKey,
						printSourceKey: source.key,
					};
				}),
		});
	}
	if (product.kind === "digital_download") {
		if (product.fulfillmentMode !== "digital_delivery") {
			throw new Error(`Digital product ${product.productKey} has invalid fulfillment`);
		}
		const digitalFile = validateDigitalSourceCompatibility(product);
		return canonicalizeCatalogProductGraphV2Draft({
			...common,
			productKind: "digital_download",
			fulfillmentMode: "digital_delivery",
			paidFile: {
				key: "download",
				assetId: requireMapping(
					targets.paidFiles,
					digitalFile.sourceFileRef,
					"Paid file",
				),
				...(digitalFile.version === undefined ? {} : { version: digitalFile.version }),
			},
		});
	}
	if (
		product.kind === "postcard"
		|| product.kind === "tapestry"
		|| product.kind === "merchandise"
	) {
		if (product.fulfillmentMode !== "merchant_fulfilled") {
			throw new Error(`${product.kind} ${product.productKey} has invalid fulfillment`);
		}
		return canonicalizeCatalogProductGraphV2Draft({
			...common,
			productKind: product.kind,
			fulfillmentMode: "merchant_fulfilled",
		} as CatalogProductGraphV2Draft);
	}
	throw new Error(`Catalog product ${product.productKey} has an unsupported kind`);
}

function sourceRelationsFor(
	product: SanityCatalogImportProduct,
	draft: CatalogProductGraphV2Draft,
): SanityCatalogV2GraphPlanPayload["products"][number]["sourceRelations"] {
	const relationFor = (key: string, printSource: boolean) => {
		const placement = product.media.find((item) =>
			item.key === key && (!printSource || item.printSource)
		);
		if (!placement) throw new Error(`Catalog product ${product.productKey} lost a source relation`);
		return { key, sourceAssetRef: placement.sourceAssetRef };
	};
	const printSources = draft.productKind === "print" || draft.productKind === "print_set"
		? draft.printSources
		: [];
	return {
		webMedia: draft.webMedia.map((placement) => relationFor(placement.key, false)),
		printSources: printSources.map((source) => relationFor(source.key, true)),
		...(product.digitalFile === undefined
			? {}
			: { paidFile: { sourceFileRef: product.digitalFile.sourceFileRef } }),
	};
}

/**
 * Pure source-to-draft-graph mapping only. This candidate cannot authorize
 * transfer, private-asset registration, database writes, or catalog import.
 * Each sourceRevision is only the product document revision. Asset revisions
 * and verified byte receipts belong to the later release plan.
 */
export async function createSanityCatalogV2GraphPlan(
	manifest: SanityCatalogImportManifest,
	targets: SanityCatalogV2TargetIdMaps,
): Promise<SanityCatalogV2GraphPlan> {
	if (manifest.version !== 1) throw new Error("Sanity catalog manifest version is unsupported");
	const report = createSanityCatalogImportDryRunReport(manifest);
	if (report.draftImport.status === "blocked") {
		throw new Error("Sanity catalog manifest is blocked and cannot form a V2 graph plan");
	}
	if (manifest.products.some((product) => product.kind === "unsupported")) {
		throw new Error("Sanity catalog manifest contains an unsupported product family");
	}

	const web = exactTargetMap(
		targets.webMedia,
		report.requiredSourceImageRefs,
		(entry) => entry.sourceAssetRef,
		(entry) => entry.mediaAssetId,
		"Web media",
	);
	const print = exactTargetMap(
		targets.printSources,
		report.requiredPrintSourceImageRefs,
		(entry) => entry.sourceAssetRef,
		(entry) => entry.printSourceAssetId,
		"Print source",
	);
	const paid = exactTargetMap(
		targets.paidFiles,
		report.requiredSourceFileRefs,
		(entry) => entry.sourceFileRef,
		(entry) => entry.digitalFileAssetId,
		"Paid file",
	);
	const lookups: TargetLookups = {
		webMedia: web.byRef,
		printSources: print.byRef,
		paidFiles: paid.byRef,
	};

	const products = [] as SanityCatalogV2GraphPlanPayload["products"];
	for (const product of [...manifest.products].sort((left, right) =>
		compareOrdinal(left.productKey, right.productKey)
	)) {
		if (product.kind === "unsupported") {
			throw new Error(`Catalog product ${product.productKey} has an unsupported kind`);
		}
		if (product.sourceType !== SANITY_CATALOG_SOURCE_TYPE_BY_KIND[product.kind]) {
			throw new Error(`Catalog product ${product.productKey} has an unsupported source contract`);
		}
		if (!product.sourceRevision || !product.sourceCreatedAt || !product.sourceUpdatedAt) {
			throw new Error(`Catalog product ${product.productKey} has incomplete source metadata`);
		}
		validateSourceGraphCompleteness(product);
		const draft = draftFromProduct(product, lookups);
		validateCatalogProductGraphV2Draft(draft);
		products.push({
			sourceId: product.sourceId,
			sourceRevision: product.sourceRevision,
			sourceCreatedAt: product.sourceCreatedAt,
			sourceUpdatedAt: product.sourceUpdatedAt,
			sourceType: product.sourceType,
			productKey: product.productKey,
			sourceRelations: sourceRelationsFor(product, draft),
			draft,
			graphChecksum: await checksumCatalogProductGraphV2Draft(draft),
		});
	}

	const payload: SanityCatalogV2GraphPlanPayload = {
		version: 1,
		graphVersion: 2,
		sourceManifestVersion: 1,
		assetMappings: {
			webMedia: web.mappings.map(({ sourceRef, targetId }) => ({
				sourceAssetRef: sourceRef,
				mediaAssetId: targetId,
			})),
			printSources: print.mappings.map(({ sourceRef, targetId }) => ({
				sourceAssetRef: sourceRef,
				printSourceAssetId: targetId,
			})),
			paidFiles: paid.mappings.map(({ sourceRef, targetId }) => ({
				sourceFileRef: sourceRef,
				digitalFileAssetId: targetId,
			})),
		},
		products,
	};
	const graphPlanChecksum = await checksumSanityCatalogV2GraphPlan(payload);
	const plan = { ...payload, graphPlanChecksum };
	await assertSanityCatalogV2GraphPlan(plan);
	return plan;
}
