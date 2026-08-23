import { describe, expect, test } from "vitest";
import type { SanityBlogReconciliationPlan } from "../../packages/crm-api/convex/helpers/sanityBlogReconciliationPlan";
import {
	parseSanityBlogPublicationCliOptions,
	parseSanityBlogPublicationResult,
	requireSanityBlogPublicationConfirmation,
} from "./sanityBlogPublicationOperator";

const plan = {
	authors: [{ documentKey: "sanity.author.a", target: { documentId: "doc-a" } }],
	categories: [{ documentKey: "sanity.category.c", target: { documentId: "doc-c" } }],
	posts: [{ documentKey: "sanity.post.p", target: { documentId: "doc-p" } }],
} as unknown as SanityBlogReconciliationPlan;

const result = {
	status: "published" as const,
	digest: "a".repeat(64),
	documents: [
		{
			kind: "author" as const,
			documentKey: "sanity.author.a",
			documentId: "doc-a",
			revisionId: "rev-a",
		},
		{
			kind: "category" as const,
			documentKey: "sanity.category.c",
			documentId: "doc-c",
			revisionId: "rev-c",
		},
		{
			kind: "post" as const,
			documentKey: "sanity.post.p",
			documentId: "doc-p",
			revisionId: "rev-p",
		},
	],
};

describe("Sanity Blog publication operator", () => {
	test("requires an exact artifact and digest confirmation", () => {
		expect(parseSanityBlogPublicationCliOptions(["--artifact", "plan.json"])).toEqual({
			artifactPath: "plan.json",
			execute: false,
		});
		const options = parseSanityBlogPublicationCliOptions([
			"--artifact",
			"plan.json",
			"--execute",
			"--confirm",
			"digest",
		]);
		expect(() => requireSanityBlogPublicationConfirmation(options, "different")).toThrow(
			/Execution requires/,
		);
	});

	test("binds every returned identity to the reviewed plan", () => {
		expect(parseSanityBlogPublicationResult(result, plan, result.digest)).toEqual(result);
		expect(() =>
			parseSanityBlogPublicationResult(
				{
					...result,
					documents: result.documents.map((document, index) =>
						index === 2 ? { ...document, documentId: "wrong" } : document,
					),
				},
				plan,
				result.digest,
			),
		).toThrow(/invalid document result/);
	});
});
