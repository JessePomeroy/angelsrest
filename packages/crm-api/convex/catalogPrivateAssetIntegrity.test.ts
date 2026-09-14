/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import {
	inspectionSet,
	recordFixtureReceipt,
	storageSet,
	storedState,
	withReceiptEnvironment,
} from "../test/catalogPrivateAssetReceiptFixtures";

const modules = import.meta.glob("./**/*.ts");

async function completeRegistration(t: ReturnType<typeof convexTest>) {
	const stored = await recordFixtureReceipt(t, "storage", storageSet());
	if (stored.accepted !== true) throw new Error("storage fixture registration failed");
	const inspected = await recordFixtureReceipt(
		t,
		"inspection",
		inspectionSet(),
	);
	if (inspected.accepted !== true) throw new Error("inspection fixture registration failed");
}

async function expectReplayRejectedWithoutWrites(t: ReturnType<typeof convexTest>) {
	const before = JSON.stringify(await storedState(t));
	const response = await recordFixtureReceipt(t, "storage", storageSet());
	expect(response.accepted).toBe(false);
	expect(JSON.stringify(await storedState(t))).toBe(before);
}

describe("private catalog receipt concurrency and integrity", () => {
	test("serializes concurrent same-role and opposite-role receipt submissions", async () => {
		const sameRole = convexTest(schema, modules);
		await withReceiptEnvironment(async () => {
			const responses = await Promise.all([
				recordFixtureReceipt(sameRole, "storage", storageSet()),
				recordFixtureReceipt(sameRole, "storage", storageSet()),
			]);
			expect(responses.map((response) => response.accepted)).toEqual([true, true]);
			const bodies = await Promise.all(responses.map((response) => response.result));
			expect(bodies.map((body) => body.replayed).sort()).toEqual([false, true]);
			const state = await storedState(sameRole);
			expect(state.coordinations).toHaveLength(1);
			expect(state.printSources).toHaveLength(0);
			expect(state.paidFiles).toHaveLength(0);
		});

		const oppositeRoles = convexTest(schema, modules);
		await withReceiptEnvironment(async () => {
			const responses = await Promise.all([
				recordFixtureReceipt(oppositeRoles, "storage", storageSet()),
				recordFixtureReceipt(
					oppositeRoles,
					"inspection",
					inspectionSet(),
				),
			]);
			expect(responses.map((response) => response.accepted)).toEqual([true, true]);
			const state = await storedState(oppositeRoles);
			expect(state.coordinations).toHaveLength(1);
			expect(state.coordinations[0]?.status).toBe("verified");
			expect(state.printSources).toHaveLength(1);
			expect(state.paidFiles).toHaveLength(1);

			const replay = await recordFixtureReceipt(
				oppositeRoles,
				"storage",
				storageSet(),
			);
			const result = await replay.result as {
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
