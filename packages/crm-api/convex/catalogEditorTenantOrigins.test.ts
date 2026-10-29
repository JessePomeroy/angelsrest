import { describe, expect, it } from "vitest";
import { editorTenantOrigins } from "./helpers/catalogEditorTenantOrigins";

describe("operator-configured editor origins", () => {
	it("keeps the tenant identity when its approved custom domain changes", () => {
		const origins = editorTenantOrigins(
			JSON.stringify({
				"angelsrest.online": "https://www.angelsrest.online",
				"queenworm.angelsrest.online": "https://queenworm.com",
			}),
		);
		expect([...origins]).toEqual([
			["angelsrest.online", "https://www.angelsrest.online"],
			["queenworm.angelsrest.online", "https://queenworm.com"],
		]);
		expect(origins.get("queenworm.com")).toBeUndefined();
	});

	it("rejects assigning the same browser origin to two tenant identities", () => {
		expect(
			editorTenantOrigins(
				JSON.stringify({
					"first.example": "https://custom.example",
					"second.example": "https://custom.example",
				}),
			).size,
		).toBe(0);
	});

	it.each([
		"http://custom.example",
		"https://custom.example/",
		"https://custom.example/path",
		"https://custom.example?tenant=other",
		"https://custom.example#fragment",
		"https://user:password@custom.example",
		"https://custom.example:8443",
		"https://custom.example:443",
		"https://CUSTOM.example",
		"https://custom.example.",
		"https://*.custom.example",
		"https://localhost",
	])("fails closed for a noncanonical or unsafe origin: %s", (origin) => {
		expect(editorTenantOrigins(JSON.stringify({ "tenant.example": origin })).size).toBe(0);
	});

	it("preserves absent-registry behavior and rejects explicit invalid configuration", () => {
		expect([...editorTenantOrigins(undefined)]).toEqual([
			["angelsrest.online", "https://www.angelsrest.online"],
		]);
		for (const raw of ["", "{}", "[]", "null", "not-json", '{"tenant.example":null}'])
			expect(editorTenantOrigins(raw).size).toBe(0);
	});

	it("rejects the whole registry if any tenant identity or origin is invalid", () => {
		for (const invalid of [
			{ "https://tenant.example": "https://custom.example" },
			{ "tenant.example/path": "https://custom.example" },
			{ "TENANT.example": "https://custom.example" },
			{ "tenant.example": "https://custom.example/path" },
		]) {
			expect(
				editorTenantOrigins(
					JSON.stringify({
						"angelsrest.online": "https://www.angelsrest.online",
						...invalid,
					}),
				).size,
			).toBe(0);
		}
	});

	it("bounds registry size before admitting any tenant", () => {
		const entries = Array.from({ length: 101 }, (_, index) => [
			`tenant-${index}.example`,
			`https://custom-${index}.example`,
		]);
		expect(editorTenantOrigins(JSON.stringify(Object.fromEntries(entries))).size).toBe(0);
		expect(editorTenantOrigins(`${" ".repeat(64 * 1024)}{}`).size).toBe(0);
	});
});
