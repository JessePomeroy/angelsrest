import type { ValidatorJSON } from "convex/values";
import {
	checksumSanityBlogReconciliationPlan,
	createSanityBlogReconciliationPlan,
	requireSanityBlogReconciliationPlan,
	type SanityBlogReconciliationBuildOptions,
	type SanityBlogReconciliationPlan,
	type SanityBlogReconciliationSource,
	sanityBlogReconciliationPlanValidator,
} from "../../packages/crm-api/convex/helpers/sanityBlogReconciliationPlan";

export type SanityBlogReconciliationPlanInput = {
	source: SanityBlogReconciliationSource;
	options: SanityBlogReconciliationBuildOptions;
};

export type SanityBlogReconciliationArtifact = {
	version: 1;
	plan: SanityBlogReconciliationPlan;
	digest: string;
};

function record(value: unknown, label: string) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${label} must be a JSON object`);
	}
	return value as Record<string, unknown>;
}

function validateValue(value: unknown, validator: ValidatorJSON, label: string): void {
	switch (validator.type) {
		case "string":
		case "id":
			if (typeof value !== "string") throw new Error(`${label} must be a string`);
			return;
		case "number":
			if (typeof value !== "number") throw new Error(`${label} must be a number`);
			return;
		case "boolean":
			if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`);
			return;
		case "null":
			if (value !== null) throw new Error(`${label} must be null`);
			return;
		case "literal":
			if (value !== validator.value) throw new Error(`${label} has an invalid literal value`);
			return;
		case "array":
			if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
			for (const [index, entry] of value.entries()) {
				validateValue(entry, validator.value, `${label}[${index}]`);
			}
			return;
		case "object": {
			const valueRecord = record(value, label);
			const expectedKeys = Object.keys(validator.value).sort();
			const actualKeys = Object.keys(valueRecord).sort();
			for (const key of actualKeys) {
				if (!(key in validator.value)) throw new Error(`${label}.${key} is not allowed`);
			}
			for (const key of expectedKeys) {
				const field = validator.value[key];
				if (!(key in valueRecord) || (field.optional && valueRecord[key] === undefined)) {
					if (!field.optional) throw new Error(`${label}.${key} is required`);
					continue;
				}
				validateValue(valueRecord[key], field.fieldType, `${label}.${key}`);
			}
			return;
		}
		case "union": {
			for (const member of validator.value) {
				try {
					validateValue(value, member, label);
					return;
				} catch {
					// Try the next closed union member.
				}
			}
			throw new Error(`${label} does not match an accepted value`);
		}
		default:
			throw new Error(`${label} uses an unsupported validator type`);
	}
}

/** Parse only local reviewed JSON; plan construction performs the semantic checks. */
export function parseSanityBlogReconciliationPlanInput(
	value: unknown,
): SanityBlogReconciliationPlanInput {
	const input = record(value, "Reconciliation plan input");
	record(input.source, "Reconciliation source");
	record(input.options, "Reconciliation options");
	return input as unknown as SanityBlogReconciliationPlanInput;
}

export async function createSanityBlogReconciliationArtifact(
	input: SanityBlogReconciliationPlanInput,
): Promise<SanityBlogReconciliationArtifact> {
	const plan = createSanityBlogReconciliationPlan(input.source, input.options);
	return {
		version: 1,
		plan,
		digest: await checksumSanityBlogReconciliationPlan(plan),
	};
}

export async function parseSanityBlogReconciliationArtifact(
	value: unknown,
): Promise<SanityBlogReconciliationArtifact> {
	const artifact = record(value, "Reconciliation artifact");
	if (artifact.version !== 1 || typeof artifact.digest !== "string") {
		throw new Error("Reconciliation artifact envelope is invalid");
	}
	record(artifact.plan, "Reconciliation plan");
	validateValue(artifact.plan, sanityBlogReconciliationPlanValidator.json, "Reconciliation plan");
	const candidate = artifact as unknown as SanityBlogReconciliationArtifact;
	await requireSanityBlogReconciliationPlan(candidate.plan, candidate.digest);
	return candidate;
}
