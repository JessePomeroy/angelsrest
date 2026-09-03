import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const serverRoot = resolve(import.meta.dirname, "..");

describe("server source seams", () => {
	it("keeps current authority server-only and independent of retired or recovery code", () => {
		for (const name of readdirSync(resolve(serverRoot, "current"))) {
			expect(name).toMatch(/\.server\.ts$/);
			expect(readFileSync(resolve(serverRoot, "current", name), "utf8")).not.toMatch(
				/\$lib\/server\/(?:recovery|migration|compatibility)|sanity/i,
			);
		}
	});

	it("keeps recovery implementations server-only", () => {
		for (const name of readdirSync(resolve(serverRoot, "recovery"))) {
			expect(name).toMatch(/\.server\.ts$/);
		}
	});
});
