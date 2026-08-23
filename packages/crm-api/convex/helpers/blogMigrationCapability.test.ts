import { describe, expect, test } from "vitest";
import {
	assertBlogMigrationCapability,
	blogMigrationCapabilityFor,
	type BlogMigrationCapabilityScope,
} from "./blogMigrationCapability";

const SCOPE = {
	siteUrl: "angelsrest.online",
	purpose: "sanity-blog-reconcile-v2",
	binding: "a".repeat(64),
} as const satisfies BlogMigrationCapabilityScope;

describe("Blog migration capability", () => {
	test("is disabled by default", () => {
		expect(() => assertBlogMigrationCapability(SCOPE)).toThrow(/disabled/i);
	});

	test.each([
		["absent", null],
		["empty", ""],
		[
			"different tenant",
			blogMigrationCapabilityFor({ ...SCOPE, siteUrl: "other.example" }),
		],
		[
			"different purpose",
			blogMigrationCapabilityFor({
				...SCOPE,
				purpose: "sanity-blog-import-v1",
			}),
		],
		[
			"different binding",
			blogMigrationCapabilityFor({ ...SCOPE, binding: "b".repeat(64) }),
		],
	])("rejects an %s capability", (_label, configuredCapability) => {
		expect(() =>
			assertBlogMigrationCapability(SCOPE, configuredCapability)
		).toThrow(/disabled/i);
	});

	test("accepts only the exact tenant, purpose, and binding tuple", () => {
		expect(() =>
			assertBlogMigrationCapability(
				SCOPE,
				blogMigrationCapabilityFor(SCOPE),
			)
		).not.toThrow();
	});
});
