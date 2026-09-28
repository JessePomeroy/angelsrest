import assert from "node:assert/strict";
import { test } from "node:test";
import { run } from "./cms-orphan-cleanup.mjs";

const config = {
	siteUrl: "tenant.example",
	workerUrl: "https://media.example",
	convexUrl: "https://fixture.convex.cloud",
	token: "fixture",
	workerSecret: "fixture",
};
const assetId = "123e4567-e89b-42d3-a456-426614174000";
test("inventory follows both bucket cursors without a mutation", async () => {
	const requests = [];
	const client = {
		setAuth() {},
		mutation() {
			throw new Error("Unexpected mutation");
		},
	};
	const result = await run(
		config,
		["inventory"],
		async (_url, options) => {
			const body = JSON.parse(options.body);
			requests.push(body);
			return Response.json({ ...body, assetIds: [assetId], cursor: body.cursor ? null : "next" });
		},
		client,
	);
	assert.deepEqual(result.candidates, [assetId]);
	assert.equal(requests.length, 4);
});
test("no storage deletion occurs when registration check rejects the target", async () => {
	let fetches = 0;
	await assert.rejects(
		run(
			config,
			["delete", assetId, "--confirm", config.siteUrl],
			async () => {
				fetches++;
			},
			{
				setAuth() {},
				async mutation() {
					throw new Error("registered");
				},
			},
		),
		/registered/,
	);
	assert.equal(fetches, 0);
});
test("explicit deletion fences registration before storage and checks acknowledgement", async () => {
	const calls = [];
	const result = await run(
		config,
		["delete", assetId, "--confirm", config.siteUrl],
		async (_url, options) => {
			calls.push("storage");
			const body = JSON.parse(options.body);
			assert.equal(body.orphan, true);
			assert.equal(body.privateKeys.length, 1);
			assert.equal(body.publicKeys.length, 5);
			return Response.json({ deleted: true, siteUrl: config.siteUrl, assetId });
		},
		{
			setAuth() {},
			async mutation() {
				calls.push("fence");
			},
		},
	);
	assert.deepEqual(calls, ["fence", "storage"]);
	assert.equal(result.deleted, assetId);
});
