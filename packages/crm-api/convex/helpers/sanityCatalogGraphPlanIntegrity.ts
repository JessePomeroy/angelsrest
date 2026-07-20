import { checksumCatalogProductGraphV2Draft } from "./catalogProductGraphChecksum";
import { validateCatalogProductGraphV2Draft } from "./catalogProductGraphValidators";
import {
	SANITY_CATALOG_SOURCE_TYPE_BY_KIND,
	type SanityCatalogV2GraphPlan,
	type SanityCatalogV2GraphPlanPayload,
} from "./sanityCatalogGraphPlanContract";
import { validateCatalogProductKey } from "./catalogProductValidators";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SANITY_IMAGE_REF_PATTERN = /^image-[A-Za-z0-9]+-\d+x\d+-[A-Za-z0-9]+$/;
const SANITY_FILE_REF_PATTERN = /^file-[A-Za-z0-9]+-[A-Za-z0-9.]+$/;

function compareOrdinal(left: string, right: string) {
	return left < right ? -1 : left > right ? 1 : 0;
}

function sorted(values: readonly string[]) {
	return [...values].sort(compareOrdinal);
}

function assertExactStrings(
	actual: readonly string[],
	expected: readonly string[],
	label: string,
) {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(`${label} must match exactly`);
	}
}

function assertUnique(values: readonly string[], label: string) {
	if (new Set(values).size !== values.length) throw new Error(`${label} must be unique`);
}

function requireTrimmed(value: string, maximum: number, label: string) {
	if (!value || value !== value.trim() || value.length > maximum) {
		throw new Error(`${label} must be non-empty, trimmed, and bounded`);
	}
}

function requireSourceTimestamp(value: string, label: string) {
	requireTrimmed(value, 64, label);
	if (!Number.isFinite(Date.parse(value))) throw new Error(`${label} must be a valid timestamp`);
}

function canonicalJson(value: unknown): string {
	if (value === null) return "null";
	if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw new Error("Catalog graph plan contains a non-finite number");
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>)
			.filter(([, entry]) => entry !== undefined)
			.sort(([left], [right]) => compareOrdinal(left, right));
		return `{${entries
			.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
			.join(",")}}`;
	}
	throw new Error("Catalog graph plan contains an unsupported value");
}

export function canonicalSanityCatalogV2GraphPlan(
	plan: SanityCatalogV2GraphPlanPayload,
) {
	return `sanity-catalog-v2-graph-plan-candidate:v1:${canonicalJson(plan)}`;
}

/** Determinism checksum only; this is not a released transfer or import digest. */
export async function checksumSanityCatalogV2GraphPlan(
	plan: SanityCatalogV2GraphPlanPayload,
) {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(canonicalSanityCatalogV2GraphPlan(plan)),
	);
	return Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
}

function validateMappingOrderAndIdentity(plan: SanityCatalogV2GraphPlan) {
	const webRefs = plan.assetMappings.webMedia.map((mapping) => mapping.sourceAssetRef);
	const printRefs = plan.assetMappings.printSources.map((mapping) => mapping.sourceAssetRef);
	const paidRefs = plan.assetMappings.paidFiles.map((mapping) => mapping.sourceFileRef);
	assertExactStrings(webRefs, sorted(webRefs), "Web media mapping order");
	assertExactStrings(printRefs, sorted(printRefs), "Print source mapping order");
	assertExactStrings(paidRefs, sorted(paidRefs), "Paid file mapping order");
	assertUnique(webRefs, "Web media source references");
	assertUnique(printRefs, "Print source references");
	assertUnique(paidRefs, "Paid file source references");
	if (webRefs.some((ref) => !SANITY_IMAGE_REF_PATTERN.test(ref))) {
		throw new Error("Web media source reference is invalid");
	}
	if (printRefs.some((ref) => !SANITY_IMAGE_REF_PATTERN.test(ref))) {
		throw new Error("Print source reference is invalid");
	}
	if (paidRefs.some((ref) => !SANITY_FILE_REF_PATTERN.test(ref))) {
		throw new Error("Paid file source reference is invalid");
	}
	const webIds = plan.assetMappings.webMedia.map((mapping) => mapping.mediaAssetId);
	const printIds = plan.assetMappings.printSources.map(
		(mapping) => mapping.printSourceAssetId,
	);
	const paidIds = plan.assetMappings.paidFiles.map(
		(mapping) => mapping.digitalFileAssetId,
	);
	for (const [label, ids] of [
		["Web media", webIds],
		["Print source", printIds],
		["Paid file", paidIds],
	] as const) {
		for (const id of ids) requireTrimmed(id, 120, `${label} target ID`);
		assertUnique(ids, `${label} target IDs`);
	}
	return {
		webByRef: new Map(plan.assetMappings.webMedia.map((item) => [
			item.sourceAssetRef,
			item.mediaAssetId,
		])),
		printByRef: new Map(plan.assetMappings.printSources.map((item) => [
			item.sourceAssetRef,
			item.printSourceAssetId,
		])),
		paidByRef: new Map(plan.assetMappings.paidFiles.map((item) => [
			item.sourceFileRef,
			item.digitalFileAssetId,
		])),
		webIds,
		printIds,
		paidIds,
	};
}

function validateMigrationGraphCompleteness(
	draft: SanityCatalogV2GraphPlan["products"][number]["draft"],
) {
	if (draft.productKind === "print") {
		const [primary] = draft.webMedia;
		const [source] = draft.printSources;
		if (
			draft.fulfillmentMode !== "production_partner"
			|| draft.webMedia.length !== 1
			|| draft.printSources.length !== 1
			|| !primary
			|| !source
			|| primary.role !== "primary"
			|| primary.order !== 0
			|| source.order !== 0
			|| source.key !== primary.key
		) throw new Error("Catalog migration print graph is incomplete");
		return;
	}
	if (draft.productKind === "print_set") {
		const covers = draft.webMedia.filter(({ role }) => role === "cover");
		const members = draft.webMedia.filter(({ role }) => role === "set_member");
		if (
			draft.fulfillmentMode !== "production_partner"
			|| draft.setMembers.length < 1
			|| covers.length > 1
			|| draft.webMedia.length !== covers.length + members.length
			|| members.length !== draft.setMembers.length
			|| draft.printSources.length !== draft.setMembers.length
		) throw new Error("Catalog migration print-set graph is incomplete");
		return;
	}
	const galleries = draft.webMedia.filter(({ role }) => role === "gallery");
	if (galleries.length < 1) throw new Error("Catalog migration display gallery is incomplete");
	if (draft.productKind === "digital_download" && !draft.paidFile) {
		throw new Error("Catalog migration digital graph has no paid file");
	}
}

/**
 * Revalidates deterministic graph mapping only. It cannot authorize asset
 * transfer, private-asset registration, database writes, or catalog import.
 */
export async function assertSanityCatalogV2GraphPlan(
	plan: SanityCatalogV2GraphPlan,
) {
	if (plan.version !== 1 || plan.graphVersion !== 2 || plan.sourceManifestVersion !== 1) {
		throw new Error("Catalog V2 graph plan version is unsupported");
	}
	const mappings = validateMappingOrderAndIdentity(plan);
	const productKeys = plan.products.map((product) => product.productKey);
	const sourceIds = plan.products.map((product) => product.sourceId);
	assertExactStrings(productKeys, sorted(productKeys), "Catalog graph product order");
	assertUnique(productKeys, "Catalog graph product keys");
	assertUnique(sourceIds, "Catalog graph source IDs");

	const usedWebIds = new Set<string>();
	const usedPrintIds = new Set<string>();
	const usedPaidIds = new Set<string>();
	for (const product of plan.products) {
		requireTrimmed(product.sourceId, 512, "Catalog source ID");
		requireTrimmed(product.sourceRevision, 256, "Catalog source revision");
		requireSourceTimestamp(product.sourceCreatedAt, "Catalog source creation timestamp");
		requireSourceTimestamp(product.sourceUpdatedAt, "Catalog source update timestamp");
		if (Date.parse(product.sourceCreatedAt) > Date.parse(product.sourceUpdatedAt)) {
			throw new Error("Catalog source creation timestamp cannot follow its update timestamp");
		}
		validateCatalogProductKey(product.productKey);
		if (product.productKey !== `sanity.catalog.${product.sourceId}`) {
			throw new Error("Catalog graph product source identity is invalid");
		}
		if (product.sourceType !== SANITY_CATALOG_SOURCE_TYPE_BY_KIND[product.draft.productKind]) {
			throw new Error("Catalog graph source type does not match its product kind");
		}
		validateCatalogProductGraphV2Draft(product.draft);
		validateMigrationGraphCompleteness(product.draft);
		const graphChecksum = await checksumCatalogProductGraphV2Draft(product.draft);
		if (!SHA256_PATTERN.test(product.graphChecksum) || graphChecksum !== product.graphChecksum) {
			throw new Error(`Catalog graph checksum mismatch for ${product.productKey}`);
		}

		if (product.sourceRelations.webMedia.length !== product.draft.webMedia.length) {
			throw new Error("Catalog Web media source relations are incomplete");
		}
		for (const [index, placement] of product.draft.webMedia.entries()) {
			const relation = product.sourceRelations.webMedia[index];
			if (
				!relation
				|| relation.key !== placement.key
				|| mappings.webByRef.get(relation.sourceAssetRef) !== placement.assetId
			) throw new Error("Catalog Web media source relation does not match its target graph");
			usedWebIds.add(placement.assetId);
		}

		const printSources = product.draft.productKind === "print"
			|| product.draft.productKind === "print_set"
			? product.draft.printSources
			: [];
		if (product.sourceRelations.printSources.length !== printSources.length) {
			throw new Error("Catalog print source relations are incomplete");
		}
		for (const [index, source] of printSources.entries()) {
			const relation = product.sourceRelations.printSources[index];
			if (
				!relation
				|| relation.key !== source.key
				|| mappings.printByRef.get(relation.sourceAssetRef) !== source.assetId
			) throw new Error("Catalog print source relation does not match its target graph");
			usedPrintIds.add(source.assetId);
		}
		if (product.draft.productKind === "print") {
			const webRelation = product.sourceRelations.webMedia[0];
			const printRelation = product.sourceRelations.printSources[0];
			if (!webRelation || !printRelation
				|| webRelation.sourceAssetRef !== printRelation.sourceAssetRef) {
				throw new Error("Catalog print Web and private source provenance do not match");
			}
		}
		if (product.draft.productKind === "print_set") {
			for (const member of product.draft.setMembers) {
				const webRelation = product.sourceRelations.webMedia.find(
					({ key }) => key === member.mediaPlacementKey,
				);
				const printRelation = product.sourceRelations.printSources.find(
					({ key }) => key === member.printSourceKey,
				);
				if (!webRelation || !printRelation
					|| webRelation.sourceAssetRef !== printRelation.sourceAssetRef) {
					throw new Error("Catalog set Web and private source provenance do not match");
				}
			}
		}

		const paidFile = product.draft.productKind === "digital_download"
			? product.draft.paidFile
			: undefined;
		if (Boolean(product.sourceRelations.paidFile) !== Boolean(paidFile)) {
			throw new Error("Catalog paid-file source relation is incomplete");
		}
		if (paidFile && product.sourceRelations.paidFile) {
			if (mappings.paidByRef.get(product.sourceRelations.paidFile.sourceFileRef)
				!== paidFile.assetId) {
				throw new Error("Catalog paid-file source relation does not match its target graph");
			}
			usedPaidIds.add(paidFile.assetId);
		}
	}
	assertExactStrings(sorted([...usedWebIds]), sorted(mappings.webIds), "Web media mapping usage");
	assertExactStrings(
		sorted([...usedPrintIds]),
		sorted(mappings.printIds),
		"Print source mapping usage",
	);
	assertExactStrings(sorted([...usedPaidIds]), sorted(mappings.paidIds), "Paid file mapping usage");

	if (!SHA256_PATTERN.test(plan.graphPlanChecksum)) {
		throw new Error("Catalog graph-plan determinism checksum is invalid");
	}
	const { graphPlanChecksum, ...payload } = plan;
	if (graphPlanChecksum !== await checksumSanityCatalogV2GraphPlan(payload)) {
		throw new Error("Catalog graph-plan determinism checksum mismatch");
	}
	return plan;
}
