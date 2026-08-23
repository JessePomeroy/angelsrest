import type { SanityBlogReconciliationPlan } from "../../packages/crm-api/convex/helpers/sanityBlogReconciliationPlan";

export type SanityBlogPublicationCliOptions = {
	artifactPath: string;
	execute: boolean;
	confirmation?: string;
};

export type SanityBlogPublicationResult = {
	status: "published" | "identical-replay";
	digest: string;
	documents: Array<{
		kind: "author" | "category" | "post";
		documentKey: string;
		documentId: string;
		revisionId: string;
	}>;
};

export function parseSanityBlogPublicationCliOptions(
	args: string[],
): SanityBlogPublicationCliOptions {
	let artifactPath: string | undefined;
	let execute = false;
	let confirmation: string | undefined;
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--") continue;
		if (arg === "--artifact") artifactPath = args[++index];
		else if (arg === "--execute") execute = true;
		else if (arg === "--confirm") confirmation = args[++index];
		else throw new Error(`Unsupported argument: ${arg}`);
	}
	if (!artifactPath) throw new Error("--artifact <plan.json> is required");
	if (!execute && confirmation !== undefined) {
		throw new Error("--confirm is valid only with --execute");
	}
	return { artifactPath, execute, ...(confirmation ? { confirmation } : {}) };
}

export function requireSanityBlogPublicationConfirmation(
	options: SanityBlogPublicationCliOptions,
	digest: string,
) {
	if (options.execute && options.confirmation !== digest) {
		throw new Error(`Execution requires --confirm ${digest}`);
	}
}

export function parseSanityBlogPublicationResult(
	value: unknown,
	plan: SanityBlogReconciliationPlan,
	digest: string,
): SanityBlogPublicationResult {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("Convex publication returned an invalid result");
	}
	const result = value as Partial<SanityBlogPublicationResult>;
	const expected = new Map<
		string,
		{ kind: SanityBlogPublicationResult["documents"][number]["kind"]; documentId: string }
	>([
		...plan.authors.map(
			({ documentKey, target }) =>
				[documentKey, { kind: "author" as const, documentId: target.documentId }] as const,
		),
		...plan.categories.map(
			({ documentKey, target }) =>
				[documentKey, { kind: "category" as const, documentId: target.documentId }] as const,
		),
		...plan.posts.map(
			({ documentKey, target }) =>
				[documentKey, { kind: "post" as const, documentId: target.documentId }] as const,
		),
	]);
	if (
		(result.status !== "published" && result.status !== "identical-replay") ||
		result.digest !== digest ||
		!Array.isArray(result.documents) ||
		result.documents.length !== expected.size
	) {
		throw new Error("Convex publication returned an invalid result");
	}
	for (const document of result.documents) {
		if (typeof document !== "object" || document === null) {
			throw new Error("Convex publication returned an invalid document result");
		}
		const expectedDocument = expected.get(document.documentKey);
		if (
			!expectedDocument ||
			expectedDocument.kind !== document.kind ||
			expectedDocument.documentId !== document.documentId ||
			typeof document.revisionId !== "string"
		) {
			throw new Error("Convex publication returned an invalid document result");
		}
	}
	if (
		new Set(result.documents.map(({ documentKey }) => documentKey)).size !== expected.size ||
		new Set(result.documents.map(({ documentId }) => documentId)).size !== expected.size ||
		new Set(result.documents.map(({ revisionId }) => revisionId)).size !== expected.size
	) {
		throw new Error("Convex publication returned duplicate document identities");
	}
	return result as SanityBlogPublicationResult;
}
