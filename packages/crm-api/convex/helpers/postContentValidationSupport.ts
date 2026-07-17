export const POST_CONTENT_LIMITS = {
	documents: 100,
	documentKey: 120,
	title: 200,
	slug: 96,
	summary: 320,
	seoTitle: 200,
	seoDescription: 320,
	sectionText: 5_000,
	credits: 5_000,
	technicalItems: 50,
	technicalItemKey: 120,
	technicalItemLabel: 160,
	technicalItemDetails: 1_000,
	categories: 20,
	referenceKey: 120,
	bodyBlocks: 300,
	bodyImages: 100,
	placementKey: 120,
	altText: 500,
	caption: 2_000,
} as const;

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

export type PostFormatValue = "essay" | "projectStory" | "technicalNote";
export type PostPresentationValue =
	| "standard"
	| "behindTheScenes"
	| "caseStudy"
	| "clientStory"
	| "technical";

export type PostTechnicalItemShape = {
	key: string;
	label?: string;
	details?: string;
};

export function assertOnlyKeys(
	value: object,
	allowed: ReadonlySet<string>,
	label: string,
) {
	for (const key of Object.keys(value)) {
		if (!allowed.has(key)) {
			throw new Error(`${label} contains unsupported field "${key}"`);
		}
	}
}

export function assertMaximum(
	value: string | undefined,
	maximum: number,
	field: string,
) {
	if (value !== undefined && value.length > maximum) {
		throw new Error(`${field} must be ${maximum} characters or fewer`);
	}
}

export function requireText(
	value: string | undefined,
	field: string,
	maximum: number,
) {
	const normalized = value?.trim() ?? "";
	if (!normalized) throw new Error(`${field} is required before publishing`);
	assertMaximum(normalized, maximum, field);
	return normalized;
}

export function requireCanonicalPostSlug(value: string | undefined) {
	const slug = requireText(value, "Post slug", POST_CONTENT_LIMITS.slug);
	if (slug !== value || !SLUG_PATTERN.test(slug)) {
		throw new Error(
			"Post slug must use normalized lowercase words separated by hyphens",
		);
	}
	return slug;
}

export function postSlugCandidate(title: string) {
	return title
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[\u2018\u2019']/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, POST_CONTENT_LIMITS.slug)
		.replace(/-+$/g, "");
}

export function validatePostKey(
	value: string,
	maximum: number,
	field: string,
) {
	if (
		!value
		|| value.length > maximum
		|| value !== value.trim()
		|| !KEY_PATTERN.test(value)
	) {
		throw new Error(
			`${field} must be ${maximum} characters or fewer and use letters, numbers, dot, underscore, colon, or hyphen`,
		);
	}
	return value;
}

export function validateTechnicalItems(
	items: PostTechnicalItemShape[],
	field: "Equipment" | "Materials",
) {
	if (items.length > POST_CONTENT_LIMITS.technicalItems) {
		throw new Error(
			`${field} cannot contain more than ${POST_CONTENT_LIMITS.technicalItems} items`,
		);
	}
	const keys = new Set<string>();
	for (const item of items) {
		assertOnlyKeys(item, new Set(["key", "label", "details"]), `${field} item`);
		validatePostKey(
			item.key,
			POST_CONTENT_LIMITS.technicalItemKey,
			`${field} item key`,
		);
		if (keys.has(item.key)) throw new Error(`${field} item keys must be unique`);
		keys.add(item.key);
		assertMaximum(
			item.label,
			POST_CONTENT_LIMITS.technicalItemLabel,
			`${field} item label`,
		);
		assertMaximum(
			item.details,
			POST_CONTENT_LIMITS.technicalItemDetails,
			`${field} item details`,
		);
	}
}

function requireTechnicalItemContent(
	items: PostTechnicalItemShape[],
	field: string,
) {
	for (const item of items) {
		if (!item.label?.trim() && !item.details?.trim()) {
			throw new Error(`${field} items need a label or details before publishing`);
		}
	}
}

export function assertPostPresentation(
	format: PostFormatValue,
	presentation: PostPresentationValue,
) {
	const compatible =
		(format === "essay"
			&& (presentation === "standard" || presentation === "behindTheScenes"))
		|| (format === "projectStory"
			&& (presentation === "caseStudy" || presentation === "clientStory"))
		|| (format === "technicalNote" && presentation === "technical");
	if (!compatible) throw new Error("Post presentation does not match its format");
}

export function assertPostFormatFields(payload: {
	format: PostFormatValue;
	brief?: string;
	approach?: string;
	outcome?: string;
	credits?: string;
	equipment: PostTechnicalItemShape[];
	materials: PostTechnicalItemShape[];
}) {
	assertPostFormatCounts({
		...payload,
		equipmentCount: payload.equipment.length,
		materialCount: payload.materials.length,
	});
	if (payload.format === "technicalNote") {
		requireTechnicalItemContent(payload.equipment, "Equipment");
		requireTechnicalItemContent(payload.materials, "Materials");
	}
}

/** Validate format-owned scalar fields from a compact revision header. */
export function assertPostFormatCounts(payload: {
	format: PostFormatValue;
	brief?: string;
	approach?: string;
	outcome?: string;
	credits?: string;
	equipmentCount: number;
	materialCount: number;
}) {
	if (payload.format === "projectStory") {
		requireText(payload.brief, "Post brief", POST_CONTENT_LIMITS.sectionText);
		requireText(
			payload.approach,
			"Post approach",
			POST_CONTENT_LIMITS.sectionText,
		);
		requireText(payload.outcome, "Post outcome", POST_CONTENT_LIMITS.sectionText);
		if (payload.equipmentCount > 0 || payload.materialCount > 0) {
			throw new Error("Project Stories cannot publish Technical Note item lists");
		}
		return;
	}
	if (payload.format === "technicalNote") {
		if (
			payload.brief?.trim()
			|| payload.approach?.trim()
			|| payload.outcome?.trim()
			|| payload.credits?.trim()
		) throw new Error("Technical Notes cannot publish Project Story sections");
		if (payload.equipmentCount === 0 && payload.materialCount === 0) {
			throw new Error(
				"Technical Notes require at least one equipment or material item",
			);
		}
		return;
	}
	if (
		payload.brief?.trim()
		|| payload.approach?.trim()
		|| payload.outcome?.trim()
		|| payload.credits?.trim()
		|| payload.equipmentCount > 0
		|| payload.materialCount > 0
	) throw new Error("Essay Posts cannot publish fields owned by another format");
}

export function stableTechnicalItems(items: PostTechnicalItemShape[]) {
	return items.map((item) => ({
		key: item.key,
		label: item.label ?? null,
		details: item.details ?? null,
	}));
}
