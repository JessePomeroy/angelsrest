import { afterEach, describe, expect, test, vi } from "vitest";
import {
	assertBlogMigrationCapability,
	blogMigrationCapabilityFor,
	type BlogMigrationCapabilityScope,
} from "./blogMigrationCapability";

const SCOPE = {
	siteUrl: "angelsrest.online",
	purpose: "blog-pinned-restore-v1",
	binding: "a".repeat(64),
} as const satisfies BlogMigrationCapabilityScope;

describe("Blog migration capability", () => {
	afterEach(() => vi.unstubAllEnvs());

	test("is disabled by default", () => {
		vi.stubEnv("BLOG_MIGRATION_CAPABILITY", "");
		expect(() => assertBlogMigrationCapability(SCOPE)).toThrow(/disabled/i);
	});

	test("reads the exact capability from the runtime-private environment", () => {
		vi.stubEnv("BLOG_MIGRATION_CAPABILITY", blogMigrationCapabilityFor(SCOPE));
		expect(() => assertBlogMigrationCapability(SCOPE)).not.toThrow();
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
			`blog-migration:v1:${JSON.stringify([
				SCOPE.siteUrl,
				"different-purpose-v1",
				SCOPE.binding,
			])}`,
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
