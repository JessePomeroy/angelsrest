/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const SITE = "angelsrest.online";
const SOURCE = {
	projectId: "n7rvza4g",
	dataset: "production",
	perspective: "published" as const,
};

const V1_PLAN = {
	version: 1 as const,
	migrationId: "dormant-v1",
	siteUrl: SITE,
	source: SOURCE,
	assetMappings: [],
	authors: [],
	categories: [],
	posts: [],
};

const V2_PLAN = {
	version: 2 as const,
	migrationId: "dormant-v2",
	siteUrl: SITE,
	source: SOURCE,
	predecessor: {
		version: 1 as const,
		migrationId: V1_PLAN.migrationId,
		siteUrl: SITE,
		expectedDigest: "a".repeat(64),
		source: SOURCE,
	},
	decisionSet: {
		id: "dormant-decisions",
		categorySlugs: [],
		postSummaries: [],
		imagePlacements: [],
		gearMappings: [],
		unsupportedFields: [],
		absentTargetFields: [],
	},
	assetMappings: [],
	authors: [],
	categories: [],
	posts: [],
};

const reconcileDrafts = makeFunctionReference<
	"mutation",
	{ plan: typeof V2_PLAN; digest: string }
>("sanityBlogReconciliation:reconcileDrafts");

describe("dormant Blog migration entrypoints", () => {
	test("deny v1 import and v2 reconciliation before storage access", async () => {
		const t = convexTest(schema, modules);

		await expect(
			t.mutation(internal.blogContent.importSanityBlogDrafts, {
				plan: V1_PLAN,
				digest: "a".repeat(64),
			}),
		).rejects.toThrow(/capability is disabled/i);
		await expect(
			t.mutation(reconcileDrafts, {
				plan: V2_PLAN,
				digest: "b".repeat(64),
			}),
		).rejects.toThrow(/capability is disabled/i);

		expect(
			await t.run(async (ctx) =>
				await Promise.all([
					ctx.db.query("contentDocuments").take(1),
					ctx.db.query("contentRevisions").take(1),
				]),
			),
		).toEqual([[], []]);
	});
});
