import { describe, expect, test } from "vitest";
import type { SanityBlogReconciliationPlan } from "../../packages/crm-api/convex/helpers/sanityBlogReconciliationPlan";
import {
	parseSanityBlogReconciliationCliOptions,
	parseSanityBlogReconciliationResult,
	requireSanityBlogReconciliationExecutionConfirmation,
} from "./sanityBlogReconciliationOperator";

const plan = {
	authors: [{ documentKey: "sanity.author.a", target: { documentId: "author-id" } }],
	categories: [{ documentKey: "sanity.category.c", target: { documentId: "category-id" } }],
	posts: [{ documentKey: "sanity.post.p", target: { documentId: "post-id" } }],
} as unknown as SanityBlogReconciliationPlan;
const digest = "a".repeat(64);
const documents = [
	{
		kind: "author" as const,
		documentKey: "sanity.author.a",
		documentId: "author-id",
		revisionId: "author-revision",
	},
	{
		kind: "category" as const,
		documentKey: "sanity.category.c",
		documentId: "category-id",
		revisionId: "category-revision",
	},
	{
		kind: "post" as const,
		documentKey: "sanity.post.p",
		documentId: "post-id",
		revisionId: "post-revision",
	},
];

describe("Sanity Blog reconciliation operator", () => {
	test("keeps validation read-only unless exact digest execution is requested", () => {
		expect(parseSanityBlogReconciliationCliOptions(["--artifact", "plan.json"])).toEqual({
			artifactPath: "plan.json",
			execute: false,
		});
		const execute = parseSanityBlogReconciliationCliOptions([
			"--artifact",
			"plan.json",
			"--execute",
			"--confirm",
			digest,
		]);
		expect(() =>
			requireSanityBlogReconciliationExecutionConfirmation(execute, digest),
		).not.toThrow();
		expect(() =>
			requireSanityBlogReconciliationExecutionConfirmation(
				{ ...execute, confirmation: "wrong" },
				digest,
			),
		).toThrow(/requires --confirm/i);
	});

	test("accepts only the exact bounded document result", () => {
		expect(
			parseSanityBlogReconciliationResult(
				{ status: "identical-replay", digest, documents },
				plan,
				digest,
			),
		).toEqual({ status: "identical-replay", digest, documents });
		expect(() =>
			parseSanityBlogReconciliationResult(
				{ status: "identical-replay", digest, documents: documents.slice(1) },
				plan,
				digest,
			),
		).toThrow(/invalid result/i);
		expect(() =>
			parseSanityBlogReconciliationResult(
				{
					status: "identical-replay",
					digest,
					documents: [{ ...documents[0], documentId: "wrong-author-id" }, ...documents.slice(1)],
				},
				plan,
				digest,
			),
		).toThrow(/invalid document result/i);
	});
});
