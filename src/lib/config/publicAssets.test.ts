import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { expect, it } from "vitest";
import { publicAssets } from "./publicAssets";

it("keeps the responsive hero animated, smaller, and tied to its immutable URL", async () => {
	const [original, small] = await Promise.all([
		readFile(new URL("../assets/clouds2.gif", import.meta.url)),
		readFile(new URL("../assets/clouds2-400.gif", import.meta.url)),
	]);
	const [originalMetadata, smallMetadata] = await Promise.all([
		sharp(original, { animated: true }).metadata(),
		sharp(small, { animated: true }).metadata(),
	]);
	expect(originalMetadata.pages).toBeGreaterThan(1);
	expect(smallMetadata).toMatchObject({
		format: "gif",
		width: 400,
		pageHeight: 210,
		pages: originalMetadata.pages,
		loop: originalMetadata.loop,
		delay: originalMetadata.delay,
	});
	expect(small.byteLength).toBeLessThan(original.byteLength / 2);
	const hash = createHash("sha256").update(small).digest("hex").slice(0, 16);
	expect(new URL(publicAssets.heroSmall).pathname).toBe(
		`/sites/angelsrest.online/site/clouds2-400-${hash}.gif`,
	);
});
