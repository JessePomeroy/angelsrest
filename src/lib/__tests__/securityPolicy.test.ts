import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, getContentSecurityPolicy } from "$lib/config/securityPolicy";

function directiveSources(name: string) {
	const directive = contentSecurityPolicy
		.split(";")
		.map((value) => value.trim())
		.find((value) => value.startsWith(`${name} `));

	return directive?.split(/\s+/).slice(1) ?? [];
}

describe("production security policy", () => {
	it("allows the CMS media upload and public delivery boundaries", () => {
		expect(directiveSources("img-src")).toContain("https://media.angelsrest.online");
		expect(directiveSources("media-src")).toEqual([
			"'self'",
			"https://gallery-worker.thinkingofview.workers.dev",
		]);
		const connections = directiveSources("connect-src");
		expect(connections).toContain("https://cms-media-worker.thinkingofview.workers.dev");
		expect(connections).not.toContain("https://*.workers.dev");
	});

	it("does not authorize retired CMS network boundaries", () => {
		expect(directiveSources("img-src")).not.toContain("https://cdn.sanity.io");
		expect(directiveSources("connect-src")).not.toContain("https://*.sanity.io");
	});
});

describe("configured delivery Worker policy", () => {
	it("allows the configured exact origin only for uploads, images and video", () => {
		const origin = "https://isolated-delivery.example.test";
		const policy = getContentSecurityPolicy(`${origin}/`);
		for (const directive of contentSecurityPolicy.split("; ")) {
			const name = directive.split(" ")[0];
			const expected = ["connect-src", "img-src", "media-src"].includes(name)
				? `${directive} ${origin}`
				: directive;
			expect(policy.split("; ")).toContain(expected);
		}
		expect(policy).not.toContain("https://*.workers.dev");
	});

	it.each([
		undefined,
		"",
		"https://gallery-worker.thinkingofview.workers.dev",
		"http://delivery.example.test",
		"https://user:password@delivery.example.test",
		"https://delivery.example.test/path",
		"https://delivery.example.test?secret=example",
		"https://delivery.example.test; script-src *",
		"data:text/plain,example",
	])("preserves the existing policy for %s", (configured) => {
		expect(getContentSecurityPolicy(configured)).toBe(contentSecurityPolicy);
	});
});
