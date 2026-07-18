import { describe, expect, it } from "vitest";
import { contentSecurityPolicy } from "$lib/config/securityPolicy";

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
		expect(directiveSources("connect-src")).toContain(
			"https://cms-media-worker.thinkingofview.workers.dev",
		);
	});

	it("preserves the Sanity fallback while migration remains reversible", () => {
		expect(directiveSources("img-src")).toContain("https://cdn.sanity.io");
		expect(directiveSources("connect-src")).toContain("https://*.sanity.io");
	});
});
