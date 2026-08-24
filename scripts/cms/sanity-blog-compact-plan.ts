import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@sanity/client";
import type { Id } from "../../packages/crm-api/convex/_generated/dataModel";
import {
	ANGELS_REST_SANITY_BLOG_IMPORT_RELEASE,
	type SanityBlogImportReleaseContract,
} from "../../packages/crm-api/convex/helpers/sanityBlogImportPlan";
import type {
	SanityBlogOwnerDecisions,
	SanityBlogReconciliationBuildOptions,
	SanityBlogReconciliationSource,
	SanityBlogTargetBaseline,
} from "../../packages/crm-api/convex/helpers/sanityBlogReconciliationPlan";
import { parseSanityBlogImageAssetMap } from "./sanityBlogImportPrep";
import {
	createSanityBlogReconciliationArtifact,
	type SanityBlogReconciliationArtifact,
	type SanityBlogReconciliationPlanInput,
} from "./sanityBlogReconciliationPlan";
import { fetchPublishedSanityBlogReconciliationSource } from "./sanityBlogReconciliationSource";
import { readSanityBlogSourceConfig } from "./sanityBlogSource";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const IMAGE_ASSET_MAP_PATH = resolve(
	REPOSITORY_ROOT,
	"scripts/cms/migrations/angelsrest-blog/sanity-blog-image-asset-map.json",
);

const EVIDENCE_PATHS = {
	acceptance: "r6-blog-mapping-acceptance-d91f85dc/MAPPING-ACCEPTANCE.json",
	proposal: "r6-blog-visual-mapping-review-20260823T142405Z/PROPOSAL.json",
	proposalResult: "r6-blog-visual-mapping-review-20260823T142405Z/RESULT.json",
	proposalOffer: "r6-blog-visual-mapping-review-20260823T142405Z/OFFER.txt",
	inventoryIndex:
		"r6-blog-live-inventory-20260823T140248Z-57a5cbdf-397b-43fe-b67e-41d28c886203/INDEX.json",
	sourceInventory:
		"r6-blog-live-inventory-20260823T140248Z-57a5cbdf-397b-43fe-b67e-41d28c886203/SANITY-INVENTORY.json",
	targetInventory:
		"r6-blog-live-inventory-20260823T140248Z-57a5cbdf-397b-43fe-b67e-41d28c886203/CONVEX-INVENTORY.json",
	mappingProposal:
		"r6-blog-live-inventory-20260823T140248Z-57a5cbdf-397b-43fe-b67e-41d28c886203/MAPPING-PROPOSAL.json",
	inventoryResult:
		"r6-blog-live-inventory-20260823T140248Z-57a5cbdf-397b-43fe-b67e-41d28c886203/RESULT.json",
} as const;

export const R6_BLOG_COMPACT_BINDINGS = {
	acceptedPlanSha256: "7a384befe604972ec690e41381f39f5c4e8f4a4641304c6a642dd7eb00c5c37e",
	acceptanceSha256: "04943a5f62327ba6138b63f59d861d714cb82e138f93e968b1bda976c7da2d30",
	proposalSha256: "d91f85dc6d642e4df1d2e16c3efc5c3137b4f858f6236a8e408aa1cb0a144a1b",
	proposalResultSha256: "ed6262fd1effc21a0190d6ee8b18e21e2eca7642f7995274a7ac76e2cd5778d1",
	proposalOfferSha256: "6376539b2a7eb2ea467270a62f1f6ddd844f28c389d129787837a208991cd894",
	inventoryIndexSha256: "7ed23869e6ee393a8a56eec8b7288a7abbda697f604e99834efe1a86ebcf91fc",
	sourceInventorySha256: "9bff74d5629bf7cf45d9555628a23a8d8a4068972f333fdbe5d9684e8a0ac220",
	targetInventorySha256: "9df7ff23ec6ba1ff050d0b6df6da3986bb17f35d768b34560a18706fddd088f4",
	mappingProposalSha256: "85bda90f8967566c0ada77048d9d546e80ba70f20c6a78df7ce5911cdeb6dab5",
	inventoryResultSha256: "c236e062f35b8e9ff371051d2f0aa3c315dbce6e4d107338f2e8a602b0c28023",
	imageAssetMapSha256: "dfb9cf2efa56b3973af77b11cc3e3da2abb5670883c3b0a8330d67bf7b3724ae",
	projectId: "n7rvza4g",
	dataset: "production",
	siteUrl: "angelsrest.online",
	deployment: "loyal-swan-967",
	migrationId: "R6-blog-compact-2026-08-23",
	decisionSetId: "R6-blog-mapping-d91f85dc",
} as const;

const EXPECTED_HREFS = [
	"https://angelsrest.online",
	"https://www.angelsrest.online/shop/time-aware-theming-kit",
	"https://chromacollection.online",
	"https://fotoflo.online",
] as const;

type JsonRecord = Record<string, unknown>;

export type CompactEmptyGearOmission = {
	gearId: string;
	sourcePostId: string;
	sourceRevision: string;
	sourcePath: string;
	sourceKey: string;
	sourceOrder: number;
	action: "omit-all-null-owner-approved";
};

export type CompactBlogOwnerDecisions = SanityBlogOwnerDecisions & {
	emptyGearOmissions: CompactEmptyGearOmission[];
};

export type CompactPlanInput = Omit<SanityBlogReconciliationPlanInput, "options"> & {
	options: Omit<SanityBlogReconciliationBuildOptions, "decisions"> & {
		decisions: CompactBlogOwnerDecisions;
	};
};

type LoadedEvidence = {
	acceptance: JsonRecord;
	proposal: JsonRecord;
	index: JsonRecord;
	sourceInventory: JsonRecord;
	targetInventory: JsonRecord;
};

type PortableTextProof = {
	blockCount: 58;
	markedBlockCount: 14;
	linkCount: 4;
	hrefs: string[];
	structureSha256: string;
};

function object(value: unknown, label: string): JsonRecord {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${label} must be an object`);
	}
	return value as JsonRecord;
}

function array(value: unknown, label: string): unknown[] {
	if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
	return value;
}

function string(value: unknown, label: string): string {
	if (typeof value !== "string" || !value || value !== value.trim()) {
		throw new Error(`${label} must be non-empty trimmed text`);
	}
	return value;
}

function integer(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < 0) {
		throw new Error(`${label} must be a non-negative safe integer`);
	}
	return value as number;
}

function exact(value: unknown, expected: unknown, label: string): void {
	if (value !== expected) throw new Error(`${label} does not match the accepted binding`);
}

function sha256(value: string | Uint8Array): string {
	return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value: unknown): string {
	if (value === null) return "null";
	if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw new Error("Evidence contains a non-finite number");
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (typeof value === "object") {
		return `{${Object.entries(value as JsonRecord)
			.filter(([, entry]) => entry !== undefined)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
			.join(",")}}`;
	}
	throw new Error("Evidence contains an unsupported value");
}

function sortedStrings(values: Iterable<string>): string[] {
	return [...values].sort((left, right) => left.localeCompare(right));
}

async function readPrivateEvidence(path: string): Promise<Uint8Array> {
	const metadata = await lstat(path);
	if (
		!metadata.isFile() ||
		metadata.isSymbolicLink() ||
		metadata.nlink !== 1 ||
		metadata.uid !== process.getuid?.() ||
		(metadata.mode & 0o077) !== 0
	) {
		throw new Error(`Evidence file is not an owner-only regular file: ${path}`);
	}
	return await readFile(path);
}

async function readBoundJson(path: string, expectedSha256: string, label: string) {
	const bytes = await readPrivateEvidence(path);
	exact(sha256(bytes), expectedSha256, `${label} SHA-256`);
	return object(JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown, label);
}

function binding(value: JsonRecord, key: string, expected: string, label: string) {
	exact(value[key], expected, `${label}.${key}`);
}

export async function loadCompactBlogEvidence(evidenceRoot: string): Promise<LoadedEvidence> {
	const at = (path: (typeof EVIDENCE_PATHS)[keyof typeof EVIDENCE_PATHS]) =>
		resolve(evidenceRoot, path);
	const [
		acceptance,
		proposal,
		proposalResult,
		proposalOffer,
		index,
		sourceInventory,
		targetInventory,
		mappingProposal,
		inventoryResult,
	] = await Promise.all([
		readBoundJson(
			at(EVIDENCE_PATHS.acceptance),
			R6_BLOG_COMPACT_BINDINGS.acceptanceSha256,
			"Mapping acceptance",
		),
		readBoundJson(
			at(EVIDENCE_PATHS.proposal),
			R6_BLOG_COMPACT_BINDINGS.proposalSha256,
			"Mapping proposal",
		),
		readBoundJson(
			at(EVIDENCE_PATHS.proposalResult),
			R6_BLOG_COMPACT_BINDINGS.proposalResultSha256,
			"Mapping proposal result",
		),
		readPrivateEvidence(at(EVIDENCE_PATHS.proposalOffer)),
		readBoundJson(
			at(EVIDENCE_PATHS.inventoryIndex),
			R6_BLOG_COMPACT_BINDINGS.inventoryIndexSha256,
			"Inventory index",
		),
		readBoundJson(
			at(EVIDENCE_PATHS.sourceInventory),
			R6_BLOG_COMPACT_BINDINGS.sourceInventorySha256,
			"Source inventory",
		),
		readBoundJson(
			at(EVIDENCE_PATHS.targetInventory),
			R6_BLOG_COMPACT_BINDINGS.targetInventorySha256,
			"Target inventory",
		),
		readBoundJson(
			at(EVIDENCE_PATHS.mappingProposal),
			R6_BLOG_COMPACT_BINDINGS.mappingProposalSha256,
			"Inventory mapping proposal",
		),
		readBoundJson(
			at(EVIDENCE_PATHS.inventoryResult),
			R6_BLOG_COMPACT_BINDINGS.inventoryResultSha256,
			"Inventory result",
		),
	]);
	exact(
		sha256(proposalOffer),
		R6_BLOG_COMPACT_BINDINGS.proposalOfferSha256,
		"Proposal offer SHA-256",
	);
	exact(
		acceptance.schema,
		"angelsrest.r6.blog-mapping-proposal-acceptance.v1",
		"Mapping acceptance schema",
	);
	const acceptedArtifact = object(acceptance.acceptedArtifact, "Mapping acceptance artifact");
	binding(
		acceptedArtifact,
		"acceptedR6PlanSha256",
		R6_BLOG_COMPACT_BINDINGS.acceptedPlanSha256,
		"acceptedArtifact",
	);
	binding(
		acceptedArtifact,
		"proposalSha256",
		R6_BLOG_COMPACT_BINDINGS.proposalSha256,
		"acceptedArtifact",
	);
	binding(
		acceptedArtifact,
		"proposalResultSha256",
		R6_BLOG_COMPACT_BINDINGS.proposalResultSha256,
		"acceptedArtifact",
	);
	binding(
		acceptedArtifact,
		"offerSha256",
		R6_BLOG_COMPACT_BINDINGS.proposalOfferSha256,
		"acceptedArtifact",
	);
	const acceptedDecisions = object(acceptance.decisionAcceptance, "Mapping decision acceptance");
	exact(acceptedDecisions.acceptedDecisionCount, 32, "Accepted decision count");
	exact(
		acceptedDecisions.portraitCropAndHotspotMustBePreservedBeforeImport,
		true,
		"Portrait framing decision",
	);

	exact(proposal.schema, "angelsrest.r6.blog-mapping-decision-offer.v1", "Mapping proposal schema");
	const proposalBindings = object(proposal.bindings, "Mapping proposal bindings");
	binding(
		proposalBindings,
		"acceptedR6PlanSha256",
		R6_BLOG_COMPACT_BINDINGS.acceptedPlanSha256,
		"proposal.bindings",
	);
	binding(
		proposalBindings,
		"liveInventoryIndexSha256",
		R6_BLOG_COMPACT_BINDINGS.inventoryIndexSha256,
		"proposal.bindings",
	);
	binding(
		proposalBindings,
		"sanityInventorySha256",
		R6_BLOG_COMPACT_BINDINGS.sourceInventorySha256,
		"proposal.bindings",
	);
	binding(
		proposalBindings,
		"convexInventorySha256",
		R6_BLOG_COMPACT_BINDINGS.targetInventorySha256,
		"proposal.bindings",
	);
	binding(
		proposalBindings,
		"liveMappingProposalSha256",
		R6_BLOG_COMPACT_BINDINGS.mappingProposalSha256,
		"proposal.bindings",
	);
	exact(
		object(proposal.decisionCount, "Proposal decision count").total,
		32,
		"Proposal decision count",
	);

	exact(index.schema, "angelsrest.r6.blog-live-inventory-index.v2", "Inventory index schema");
	binding(
		index,
		"sourceInventorySha256",
		R6_BLOG_COMPACT_BINDINGS.sourceInventorySha256,
		"inventory index",
	);
	binding(
		index,
		"targetInventorySha256",
		R6_BLOG_COMPACT_BINDINGS.targetInventorySha256,
		"inventory index",
	);
	binding(
		index,
		"mappingProposalSha256",
		R6_BLOG_COMPACT_BINDINGS.mappingProposalSha256,
		"inventory index",
	);
	binding(index, "resultSha256", R6_BLOG_COMPACT_BINDINGS.inventoryResultSha256, "inventory index");
	exact(
		object(index.acceptedPlan, "Inventory accepted plan").sha256,
		R6_BLOG_COMPACT_BINDINGS.acceptedPlanSha256,
		"Inventory accepted plan",
	);
	exact(
		proposalResult.schema,
		"angelsrest.r6.blog-visual-mapping-review-result.v1",
		"Proposal result schema",
	);
	exact(
		mappingProposal.schema,
		"angelsrest.r6.blog-mapping-proposal.v2",
		"Inventory mapping schema",
	);
	exact(
		inventoryResult.schema,
		"angelsrest.r6.blog-live-inventory-result.v2",
		"Inventory result schema",
	);

	return { acceptance, proposal, index, sourceInventory, targetInventory };
}

function sourceDocuments(source: SanityBlogReconciliationSource) {
	return [
		...source.authors.map((document) => ({ kind: "author" as const, document })),
		...source.categories.map((document) => ({ kind: "category" as const, document })),
		...source.posts.map((document) => ({ kind: "post" as const, document })),
	];
}

function sourceRevisionMap(source: SanityBlogReconciliationSource) {
	const revisions = new Map<string, string>();
	for (const { kind, document } of sourceDocuments(source)) {
		const sourceId = string(document._id, `${kind} source ID`).replace(/^drafts\./, "");
		exact(document._type, kind, `${kind} ${sourceId} type`);
		const revision = string(document._rev, `${kind} ${sourceId} revision`);
		if (revisions.has(sourceId)) throw new Error(`Duplicate published source ID: ${sourceId}`);
		revisions.set(sourceId, revision);
	}
	return revisions;
}

export function requireExactFrozenSource(
	source: SanityBlogReconciliationSource,
	sourceInventoryValue: unknown,
) {
	const sourceInventory = object(sourceInventoryValue, "Sealed source inventory");
	exact(
		sourceInventory.schema,
		"angelsrest.r6.blog-sanity-inventory.v1",
		"Source inventory schema",
	);
	const expected = new Map<string, { kind: string; revision: string }>();
	for (const value of array(sourceInventory.documents, "Source inventory documents")) {
		const entry = object(value, "Source inventory document");
		exact(entry.draft, null, "Frozen source draft identity");
		const sourceId = string(entry.canonicalId, "Inventory source ID");
		const published = object(entry.published, `Inventory source ${sourceId}`);
		expected.set(sourceId, {
			kind: string(entry.type, `Inventory source ${sourceId} type`),
			revision: string(published.rev, `Inventory source ${sourceId} revision`),
		});
	}
	const actual = sourceDocuments(source);
	if (actual.length !== 6 || expected.size !== 6)
		throw new Error("Frozen Blog source must contain exactly six documents");
	for (const { kind, document } of actual) {
		const sourceId = string(document._id, `${kind} source ID`);
		const accepted = expected.get(sourceId);
		if (!accepted || accepted.kind !== kind || accepted.revision !== document._rev) {
			throw new Error(`Published source drifted: ${sourceId}`);
		}
	}
	if (source.authors.length !== 1 || source.categories.length !== 1 || source.posts.length !== 4) {
		throw new Error("Published Blog source count drifted from 1 Author, 1 Category, and 4 Posts");
	}
	if (source.posts.length > 12)
		throw new Error("Published Blog source exceeds the public list limit");
	return sourceRevisionMap(source);
}

function sourceStructure(post: JsonRecord) {
	return array(post.body, `Post ${String(post._id)} body`).map((nodeValue, order) => {
		const node = object(nodeValue, `Post body node ${order}`);
		const type = string(node._type, `Post body node ${order} type`);
		const key = string(node._key, `Post body node ${order} key`);
		if (type === "image") {
			return {
				assetRef: string(object(node.asset, `Image ${key} asset`)._ref, `Image ${key} ref`),
				key,
				order,
				type,
			};
		}
		if (type !== "block") throw new Error(`Unsupported Portable Text node: ${type}`);
		const children = array(node.children, `Block ${key} children`).map((childValue, childOrder) => {
			const child = object(childValue, `Block ${key} child ${childOrder}`);
			return {
				key: string(child._key, `Block ${key} child key`),
				marks: array(child.marks, `Block ${key} child marks`).map((mark, markIndex) =>
					string(mark, `Block ${key} child mark ${markIndex}`),
				),
				order: childOrder,
				textLength: typeof child.text === "string" ? child.text.length : 0,
				type: string(child._type, `Block ${key} child type`),
			};
		});
		const markDefs = array(node.markDefs, `Block ${key} mark definitions`).map(
			(markValue, markOrder) => {
				const mark = object(markValue, `Block ${key} mark definition ${markOrder}`);
				return {
					href: string(mark.href, `Block ${key} link href`),
					key: string(mark._key, `Block ${key} mark key`),
					order: markOrder,
					type: string(mark._type, `Block ${key} mark type`),
				};
			},
		);
		return {
			children,
			key,
			level: node.level ?? null,
			listItem: node.listItem ?? null,
			markDefs,
			order,
			style: node.style ?? "normal",
			type,
		};
	});
}

export function proveExactPortableText(
	source: SanityBlogReconciliationSource,
	sourceInventoryValue: unknown,
): PortableTextProof {
	const sourceInventory = object(sourceInventoryValue, "Sealed source inventory");
	const inventoryPosts = new Map<string, unknown[]>();
	for (const value of array(sourceInventory.documents, "Source inventory documents")) {
		const entry = object(value, "Source inventory document");
		if (entry.type !== "post") continue;
		const published = object(entry.published, "Published Post inventory");
		const body = object(
			object(published.mapping, "Published Post mapping").body,
			"Published Post body",
		);
		inventoryPosts.set(
			string(entry.canonicalId, "Inventory Post ID"),
			array(body.structure, "Inventory Post structure"),
		);
	}
	const combined: unknown[] = [];
	for (const postValue of source.posts) {
		const post = postValue as typeof postValue & JsonRecord;
		const sourceId = string(post._id, "Published Post ID");
		const structure = sourceStructure(post);
		const accepted = inventoryPosts.get(sourceId);
		if (!accepted || canonicalJson(structure) !== canonicalJson(accepted)) {
			throw new Error(`Portable Text structure drifted: ${sourceId}`);
		}
		combined.push(...structure.map((node) => ({ sourceId, node })));
	}
	const textBlocks = combined.filter(
		({ node }) => object(node, "Portable Text node").type === "block",
	);
	const markedBlocks = textBlocks.filter(({ node }) =>
		array(object(node, "Portable Text block").children, "Portable Text children").some(
			(child) =>
				array(object(child, "Portable Text child").marks, "Portable Text marks").length > 0,
		),
	);
	const hrefs = combined.flatMap(({ node }) => {
		const projected = object(node, "Portable Text node");
		if (projected.type !== "block") return [];
		return array(projected.markDefs, "Portable Text mark definitions")
			.map((mark) => object(mark, "Portable Text mark definition"))
			.filter((mark) => mark.type === "link")
			.map((mark) => string(mark.href, "Portable Text link href"));
	});
	if (textBlocks.length !== 58 || markedBlocks.length !== 14 || hrefs.length !== 4) {
		throw new Error("Portable Text proof does not equal 58 blocks, 14 marked blocks, and 4 links");
	}
	if (canonicalJson(hrefs) !== canonicalJson(EXPECTED_HREFS)) {
		throw new Error("Portable Text link hrefs drifted from the accepted source");
	}
	return {
		blockCount: 58,
		markedBlockCount: 14,
		linkCount: 4,
		hrefs,
		structureSha256: sha256(canonicalJson(combined)),
	};
}

function imageDecisionInputs(
	proposalDecisions: JsonRecord,
	imageAssetIds: Readonly<Record<string, string>>,
) {
	const inputs: Record<
		string,
		{
			altAction: "owner-replacement";
			altText: string;
			captionAction: "confirmed-absent";
			cropHotspotAction: "confirmed-absent" | "preserve-exact";
		}
	> = {};
	const decisions = array(proposalDecisions.imagePlacements, "Image placement decisions");
	if (decisions.length !== 21) throw new Error("Accepted image placement count must be 21");
	for (const [position, value] of decisions.entries()) {
		const decision = object(value, `Image placement decision ${position + 1}`);
		exact(decision.index, position + 1, "Image placement index");
		const placementId = string(decision.placementId, "Image placement ID");
		const sourceAssetRef = string(decision.sourceAssetRef, `${placementId} source asset`);
		exact(
			decision.targetMediaAssetId,
			imageAssetIds[sourceAssetRef],
			`${placementId} media mapping`,
		);
		const explicitAlt = object(decision.sourceExplicitAlt, `${placementId} source alt`);
		exact(explicitAlt.present, false, `${placementId} source alt presence`);
		exact(explicitAlt.value, null, `${placementId} source alt value`);
		const explicitCaption = object(decision.sourceExplicitCaption, `${placementId} source caption`);
		exact(explicitCaption.present, false, `${placementId} source caption presence`);
		exact(explicitCaption.value, null, `${placementId} source caption value`);
		exact(decision.captionCandidate, null, `${placementId} caption candidate`);
		exact(decision.captionRecommendation, "keep_absent", `${placementId} caption decision`);
		const framing = string(decision.framingRecommendation, `${placementId} framing decision`);
		const cropHotspotAction =
			framing === "extend_target_contract_to_preserve_exact_source_crop_and_hotspot_before_import"
				? ("preserve-exact" as const)
				: framing === "no_source_crop_or_hotspot"
					? ("confirmed-absent" as const)
					: null;
		if (!cropHotspotAction) throw new Error(`${placementId} has an unsupported framing decision`);
		if (inputs[placementId]) throw new Error(`Duplicate image placement decision: ${placementId}`);
		inputs[placementId] = {
			altAction: "owner-replacement",
			altText: string(decision.factualAltCandidate, `${placementId} factual alt text`),
			captionAction: "confirmed-absent",
			cropHotspotAction,
		};
	}
	return inputs;
}

function unexpectedFieldDecisions(sourceInventoryValue: unknown) {
	const sourceInventory = object(sourceInventoryValue, "Sealed source inventory");
	return array(sourceInventory.documents, "Source inventory documents")
		.flatMap((value) => {
			const entry = object(value, "Source inventory document");
			const sourceId = string(entry.canonicalId, "Unexpected-field source ID");
			const kind = string(entry.type, `Unexpected-field ${sourceId} kind`);
			const prefix = kind === "author" ? "authors" : kind === "category" ? "categories" : "posts";
			const published = object(entry.published, `Unexpected-field ${sourceId} source`);
			return array(published.unexpectedFields, `Unexpected fields for ${sourceId}`).flatMap(
				(fieldValue) => {
					const field = object(fieldValue, `Unexpected field for ${sourceId}`);
					const sourcePath = string(field.sourcePath, "Unexpected source path");
					if (sourcePath === "_system") return [];
					return [
						{
							sourceDocumentId: sourceId,
							sourcePath: `${prefix}.${sourceId}.${sourcePath}`,
							sourceValueCanonical: string(field.sourceValueCanonical, "Unexpected source value"),
							action: "omit-owner-approved" as const,
						},
					];
				},
			);
		})
		.sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));
}

export function buildAcceptedOwnerDecisions(
	proposalValue: unknown,
	source: SanityBlogReconciliationSource,
	sourceInventoryValue: unknown,
	imageAssetIds: Readonly<Record<string, string>>,
): CompactBlogOwnerDecisions {
	const proposal = object(proposalValue, "Accepted mapping proposal");
	const decisions = object(proposal.decisions, "Accepted mapping decisions");
	const revisions = sourceRevisionMap(source);
	const category = object(decisions.categorySlug, "Category slug decision");
	const categoryId = string(category.sourceId, "Category slug source ID");
	exact(category.sourceRevision, revisions.get(categoryId), "Category slug source revision");
	exact(
		category.recommendation,
		"accept_exact_generated_candidate",
		"Category slug recommendation",
	);

	const postSummaries: Record<string, string> = {};
	for (const value of array(decisions.postSummaries, "Post summary decisions")) {
		const summary = object(value, "Post summary decision");
		const sourceId = string(summary.sourceId, "Post summary source ID");
		exact(summary.sourceRevision, revisions.get(sourceId), `Post ${sourceId} summary revision`);
		const candidate = string(summary.generatedCandidate, `Post ${sourceId} summary`);
		if (candidate.length > 320) throw new Error(`Post ${sourceId} summary exceeds 320 characters`);
		if (postSummaries[sourceId]) throw new Error(`Duplicate Post summary decision: ${sourceId}`);
		postSummaries[sourceId] = candidate;
	}
	if (Object.keys(postSummaries).length !== 4)
		throw new Error("Accepted Post summary count must be four");

	const emptyGear = object(decisions.emptyGearItem, "Empty gear decision");
	const emptyGearPostId = string(emptyGear.sourcePostId, "Empty gear Post ID");
	const emptyGearKey = string(emptyGear.sourceKey, "Empty gear source key");
	const sourcePost = source.posts.find(({ _id }) => _id === emptyGearPostId) as
		| (SanityBlogReconciliationSource["posts"][number] & JsonRecord)
		| undefined;
	if (!sourcePost) throw new Error("Accepted empty gear Post is absent from the frozen source");
	const sourceGearItems = Array.isArray(sourcePost.gearUsed) ? sourcePost.gearUsed : [];
	const sourceOrder = sourceGearItems.findIndex(
		(item) => object(item, "Source gear item")._key === emptyGearKey,
	);
	if (sourceOrder < 0) throw new Error("Accepted empty source gear order is invalid");
	const sourceGear = object(sourceGearItems[sourceOrder], "Accepted empty source gear item");
	for (const field of ["camera", "developer", "filmStock", "lens"] as const) {
		if (sourceGear[field] !== null && sourceGear[field] !== undefined) {
			throw new Error(`Accepted empty gear item gained ${field}`);
		}
	}
	exact(
		emptyGear.recommendation,
		"treat_all_null_source_gear_row_as_no_technical_item",
		"Empty gear decision",
	);

	const absentTargetFields = array(decisions.absentTargetFields, "Absent target-field decisions")
		.map((value) => {
			const field = object(value, "Absent target-field decision");
			exact(field.recommendation, "keep_absent", "Absent target-field recommendation");
			return {
				field: string(field.field, "Absent target field") as
					| "credits"
					| "materials"
					| "seoDescription"
					| "seoTitle",
				action: "keep-absent-owner-approved" as const,
			};
		})
		.sort((left, right) => left.field.localeCompare(right.field));
	if (
		canonicalJson(absentTargetFields.map(({ field }) => field)) !==
		canonicalJson(["credits", "materials", "seoDescription", "seoTitle"])
	) {
		throw new Error("Absent target-field decisions do not cover the exact accepted set");
	}
	const publicLimit = object(decisions.publicListLimit, "Public list-limit decision");
	exact(publicLimit.currentPublishedPostCount, 4, "Accepted public Post count");
	exact(publicLimit.targetPublicListLimit, 12, "Accepted public list limit");

	return {
		id: R6_BLOG_COMPACT_BINDINGS.decisionSetId,
		categorySlugs: { [categoryId]: string(category.generatedCandidate, "Category slug") },
		postSummaries,
		imagePlacements: imageDecisionInputs(decisions, imageAssetIds),
		gearMappings: {},
		emptyGearOmissions: [
			{
				gearId: `post:${emptyGearPostId}:gear:${emptyGearKey}`,
				sourcePostId: emptyGearPostId,
				sourceRevision: string(revisions.get(emptyGearPostId), "Empty gear source revision"),
				sourcePath: `posts.${emptyGearPostId}.gearUsed.${emptyGearKey}`,
				sourceKey: emptyGearKey,
				sourceOrder,
				action: "omit-all-null-owner-approved",
			},
		],
		unsupportedFields: unexpectedFieldDecisions(sourceInventoryValue),
		absentTargetFields,
	};
}

export function targetBaselinesFromInventory(targetInventoryValue: unknown) {
	const inventory = object(targetInventoryValue, "Sealed target inventory");
	exact(inventory.schema, "angelsrest.r6.blog-convex-inventory.v2", "Target inventory schema");
	exact(inventory.siteUrl, R6_BLOG_COMPACT_BINDINGS.siteUrl, "Target inventory tenant");
	exact(inventory.deployment, R6_BLOG_COMPACT_BINDINGS.deployment, "Target inventory deployment");
	const expectedKeys = sortedStrings([
		...ANGELS_REST_SANITY_BLOG_IMPORT_RELEASE.documentKeys.authors,
		...ANGELS_REST_SANITY_BLOG_IMPORT_RELEASE.documentKeys.categories,
		...ANGELS_REST_SANITY_BLOG_IMPORT_RELEASE.documentKeys.posts,
	]);
	const documents = array(inventory.documents, "Target inventory documents")
		.map((value) => object(value, "Target inventory document"))
		.filter(
			({ documentKey }) => typeof documentKey === "string" && expectedKeys.includes(documentKey),
		);
	if (documents.length !== 6)
		throw new Error("Target inventory does not contain the exact six imported documents");
	const revisions = array(inventory.revisions, "Target inventory revisions").map((value) =>
		object(value, "Target inventory revision"),
	);
	const targets: Record<string, SanityBlogTargetBaseline> = {};
	for (const document of documents) {
		const documentKey = string(document.documentKey, "Target document key");
		const documentId = string(document.documentId, `Target ${documentKey} ID`);
		const draftRevisionId = string(
			document.draftRevisionId,
			`Target ${documentKey} draft revision`,
		);
		if (
			document.publishedRevisionId !== null ||
			document.publishedAt !== null ||
			document.publishedByClass !== null ||
			document.archivedAt !== null ||
			document.archivedByClass !== null ||
			document.createdByClass !== "sanityImport" ||
			document.updatedByClass !== "sanityImport" ||
			document.createdAt !== document.updatedAt
		)
			throw new Error(`Target ${documentKey} is not the untouched unpublished import baseline`);
		const matching = revisions.filter((revision) => revision.documentId === documentId);
		if (matching.length !== 1 || matching[0]?.revisionId !== draftRevisionId) {
			throw new Error(`Target ${documentKey} revision set drifted in sealed evidence`);
		}
		const revision = matching[0];
		if (revision.source !== "sanityImport" || revision.createdByClass !== "sanityImport") {
			throw new Error(`Target ${documentKey} revision provenance is invalid`);
		}
		targets[documentKey] = {
			documentId: documentId as Id<"contentDocuments">,
			draftRevisionId: draftRevisionId as Id<"contentRevisions">,
			draftChecksum: string(revision.checksum, `Target ${documentKey} checksum`),
			documentSlug: string(document.slug, `Target ${documentKey} slug`),
			rank: integer(document.rank, `Target ${documentKey} rank`),
		};
	}
	if (canonicalJson(sortedStrings(Object.keys(targets))) !== canonicalJson(expectedKeys)) {
		throw new Error("Target baselines do not cover the exact released document keys");
	}
	return targets;
}

export function buildCompactPlanInput(args: {
	source: SanityBlogReconciliationSource;
	proposal: unknown;
	sourceInventory: unknown;
	targetInventory: unknown;
	imageAssetIds: Readonly<Record<string, string>>;
}): CompactPlanInput {
	requireExactFrozenSource(args.source, args.sourceInventory);
	return {
		source: args.source,
		options: {
			migrationId: R6_BLOG_COMPACT_BINDINGS.migrationId,
			siteUrl: R6_BLOG_COMPACT_BINDINGS.siteUrl,
			source: {
				projectId: R6_BLOG_COMPACT_BINDINGS.projectId,
				dataset: R6_BLOG_COMPACT_BINDINGS.dataset,
				perspective: "published",
			},
			predecessor: ANGELS_REST_SANITY_BLOG_IMPORT_RELEASE as SanityBlogImportReleaseContract,
			imageAssetIds: args.imageAssetIds,
			targets: targetBaselinesFromInventory(args.targetInventory),
			decisions: buildAcceptedOwnerDecisions(
				args.proposal,
				args.source,
				args.sourceInventory,
				args.imageAssetIds,
			),
		},
	};
}

function cliOptions(args: string[]) {
	let evidenceRoot: string | undefined;
	let outDir: string | undefined;
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--") continue;
		if (arg === "--evidence-root") evidenceRoot = args[++index];
		else if (arg === "--out-dir") outDir = args[++index];
		else throw new Error(`Unsupported argument: ${arg}`);
	}
	if (!evidenceRoot || !outDir) {
		throw new Error("Usage: --evidence-root <angelsrest-audits> --out-dir <new-private-directory>");
	}
	return { evidenceRoot: resolve(evidenceRoot), outDir: resolve(outDir) };
}

async function writePrivateJson(path: string, value: unknown) {
	await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
}

async function main() {
	process.umask(0o077);
	const paths = cliOptions(process.argv.slice(2));
	const evidence = await loadCompactBlogEvidence(paths.evidenceRoot);
	const mapBytes = await readFile(IMAGE_ASSET_MAP_PATH);
	exact(
		sha256(mapBytes),
		R6_BLOG_COMPACT_BINDINGS.imageAssetMapSha256,
		"Checked-in image map SHA-256",
	);
	const imageAssetIds = parseSanityBlogImageAssetMap(
		JSON.parse(mapBytes.toString("utf8")) as unknown,
	);
	const { projectId, dataset } = await readSanityBlogSourceConfig(REPOSITORY_ROOT);
	exact(projectId, R6_BLOG_COMPACT_BINDINGS.projectId, "Configured Sanity project");
	exact(dataset, R6_BLOG_COMPACT_BINDINGS.dataset, "Configured Sanity dataset");
	const client = createClient({ projectId, dataset, apiVersion: "2024-01-01", useCdn: false });
	const source = await fetchPublishedSanityBlogReconciliationSource(client);
	const portableText = proveExactPortableText(source, evidence.sourceInventory);
	const input = buildCompactPlanInput({
		source,
		proposal: evidence.proposal,
		sourceInventory: evidence.sourceInventory,
		targetInventory: evidence.targetInventory,
		imageAssetIds,
	});
	const artifact = (await createSanityBlogReconciliationArtifact(
		input as SanityBlogReconciliationPlanInput,
	)) as SanityBlogReconciliationArtifact;
	const revisions = sortedStrings(
		[...sourceRevisionMap(source)].map(([sourceId, revision]) => `${sourceId}:${revision}`),
	);
	const report = {
		schema: "angelsrest.r6.blog-compact-plan-preparation.v1",
		preparedAtUtc: new Date().toISOString(),
		status: "ready",
		bindings: {
			...R6_BLOG_COMPACT_BINDINGS,
			artifactDigest: artifact.digest,
		},
		source: {
			perspective: "published",
			counts: {
				authors: source.authors.length,
				categories: source.categories.length,
				posts: source.posts.length,
			},
			revisionSetSha256: sha256(canonicalJson(revisions)),
		},
		portableText,
		target: {
			baselineDocumentCount: Object.keys(input.options.targets).length,
			baselineSha256: sha256(canonicalJson(input.options.targets)),
		},
		effects: { sanityPublishedReads: 1, convexReads: 0, sanityWrites: 0, convexWrites: 0 },
	};
	await mkdir(paths.outDir, { mode: 0o700 });
	const artifactPath = resolve(paths.outDir, "RECONCILIATION-ARTIFACT.json");
	const reportPath = resolve(paths.outDir, "PREPARATION-REPORT.json");
	await writePrivateJson(artifactPath, artifact);
	await writePrivateJson(reportPath, report);
	console.log(`R6 Blog compact plan ready: ${artifact.digest}`);
	console.log(`Artifact: ${artifactPath}`);
	console.log(`Report: ${reportPath}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	void main().catch((error) => {
		console.error(
			error instanceof Error ? error.message : "R6 Blog compact plan preparation failed",
		);
		process.exitCode = 1;
	});
}
