import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const root = process.cwd();
const source = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("portal public query seam", () => {
	test("keeps every current host read on the safe public query", () => {
		for (const path of [
			"src/routes/portal/[token]/+page.server.ts",
			"src/routes/delivery/[token]/+page.server.ts",
			"src/lib/server/portalToken.ts",
		]) {
			const host = source(path);
			expect(host).toContain("api.portal.getPublicByToken");
			expect(host).not.toContain("api.portal.getByToken");
		}
	});
});
