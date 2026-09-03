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
		const connections = directiveSources("connect-src");
		expect(connections).toContain("https://cms-media-worker.thinkingofview.workers.dev");
		expect(connections).not.toContain("https://*.workers.dev");
	});

	it("does not authorize retired CMS network boundaries", () => {
		expect(directiveSources("img-src")).not.toContain("https://cdn.sanity.io");
		expect(directiveSources("connect-src")).not.toContain("https://*.sanity.io");
	});
});
