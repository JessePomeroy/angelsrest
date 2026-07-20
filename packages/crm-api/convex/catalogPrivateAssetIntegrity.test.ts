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
	inspectionSet,
	postReceipt,
	storageSet,
	storedState,
	withReceiptEnvironment,
} from "../test/catalogPrivateAssetReceiptFixtures";

const modules = import.meta.glob("./**/*.ts");

async function completeRegistration(t: ReturnType<typeof convexTest>) {
	const stored = await postReceipt(t, STORAGE_PATH, STORAGE_SECRET_A, storageSet());
	if (stored.status !== 200) throw new Error("storage fixture registration failed");
	const inspected = await postReceipt(
		t,
		INSPECTION_PATH,
		INSPECTION_SECRET_A,
		inspectionSet(),
	);
	if (inspected.status !== 200) throw new Error("inspection fixture registration failed");
}

async function expectReplayRejectedWithoutWrites(t: ReturnType<typeof convexTest>) {
	const before = JSON.stringify(await storedState(t));
	const response = await postReceipt(t, STORAGE_PATH, STORAGE_SECRET_A, storageSet());
	expect(response.status).toBe(409);
	expect(JSON.stringify(await storedState(t))).toBe(before);
}

describe("private catalog receipt concurrency and integrity", () => {
	test("serializes concurrent same-role and opposite-role receipt submissions", async () => {
		const sameRole = convexTest(schema, modules);
		await withReceiptEnvironment(async () => {
			const responses = await Promise.all([
				postReceipt(sameRole, STORAGE_PATH, STORAGE_SECRET_A, storageSet()),
				postReceipt(sameRole, STORAGE_PATH, STORAGE_SECRET_A, storageSet()),
			]);
			expect(responses.map((response) => response.status)).toEqual([200, 200]);
			const bodies = await Promise.all(responses.map((response) => response.json()));
			expect(bodies.map((body) => body.replayed).sort()).toEqual([false, true]);
			const state = await storedState(sameRole);
			expect(state.coordinations).toHaveLength(1);
			expect(state.printSources).toHaveLength(0);
			expect(state.paidFiles).toHaveLength(0);
		});

		const oppositeRoles = convexTest(schema, modules);
		await withReceiptEnvironment(async () => {
			const responses = await Promise.all([
				postReceipt(oppositeRoles, STORAGE_PATH, STORAGE_SECRET_A, storageSet()),
				postReceipt(
					oppositeRoles,
					INSPECTION_PATH,
					INSPECTION_SECRET_A,
					inspectionSet(),
				),
			]);
			expect(responses.map((response) => response.status)).toEqual([200, 200]);
			const state = await storedState(oppositeRoles);
			expect(state.coordinations).toHaveLength(1);
			expect(state.coordinations[0]?.status).toBe("verified");
			expect(state.printSources).toHaveLength(1);
			expect(state.paidFiles).toHaveLength(1);

			const replay = await postReceipt(
				oppositeRoles,
				STORAGE_PATH,
				STORAGE_SECRET_A,
				storageSet(),
			);
			const result = await replay.json() as {
				status: string;
				targets: Array<{ assetId: string }>;
			};
			expect(result.status).toBe("verified");
			expect(new Set(result.targets.map((target) => target.assetId))).toEqual(new Set([
				state.printSources[0]!._id,
				state.paidFiles[0]!._id,
			]));
		});
	});

	test("fails closed when a verified target is deleted", async () => {
		const t = convexTest(schema, modules);
		await withReceiptEnvironment(async () => {
			await completeRegistration(t);
			const state = await storedState(t);
			await t.run(async (ctx) => await ctx.db.delete(state.printSources[0]!._id));
			await expectReplayRejectedWithoutWrites(t);
		});
	});

	test("fails closed when verified coordination checksums or audit times drift", async () => {
		for (const field of ["assetSetChecksum", "updatedAt"] as const) {
			const t = convexTest(schema, modules);
			await withReceiptEnvironment(async () => {
				await completeRegistration(t);
				const state = await storedState(t);
				const coordination = state.coordinations[0];
				if (!coordination || coordination.status !== "verified") {
					throw new Error("verified coordination fixture missing");
				}
				await t.run(async (ctx) => {
					await ctx.db.patch(coordination._id, field === "assetSetChecksum"
						? { assetSetChecksum: "f".repeat(64) }
						: { updatedAt: coordination.updatedAt + 1 });
				});
				await expectReplayRejectedWithoutWrites(t);
			});
		}
	});
});
