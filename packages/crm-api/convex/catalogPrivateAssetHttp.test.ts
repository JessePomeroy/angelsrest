/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import {
	INSPECTION_PATH,
	INSPECTION_SECRET_A,
	STORAGE_PATH,
	STORAGE_SECRET_A,
	storedState,
	withReceiptEnvironment,
} from "../test/catalogPrivateAssetReceiptFixtures";

const modules = import.meta.glob("./**/*.ts");
const roles = [
	{ role: "storage", path: STORAGE_PATH, secret: STORAGE_SECRET_A },
	{ role: "inspection", path: INSPECTION_PATH, secret: INSPECTION_SECRET_A },
] as const;

describe("private catalog receipt HTTP limits", () => {
	test.each(roles)("rejects malformed credentials and streamed $role overflow", async ({
		path,
		secret,
	}) => {
		const t = convexTest(schema, modules);
		await withReceiptEnvironment(async () => {
			const malformedCredential = await t.fetch(path, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: "{}",
			});
			expect(malformedCredential.status).toBe(401);

			let canceled = false;
			let chunkCount = 0;
			const oversized = await t.fetch(path, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${secret}`,
					"Content-Type": "application/json",
				},
				body: new ReadableStream({
					pull(controller) {
						chunkCount += 1;
						controller.enqueue(new Uint8Array(64 * 1024));
						if (chunkCount === 8) controller.close();
					},
					cancel() {
						canceled = true;
					},
				}),
				duplex: "half",
			} as RequestInit);
			expect(oversized.status).toBe(400);
			expect(canceled).toBe(true);
			expect(chunkCount).toBeLessThan(8);
		});
		expect((await storedState(t)).coordinations).toHaveLength(0);
	});
});
