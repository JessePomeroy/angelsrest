import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { run } from "./content-export.mjs";

const config = {
	siteUrl: "queenworm.example",
	convexUrl: "https://synthetic.convex.cloud",
	workerUrl: "https://media.example",
	token: "test-session",
	workerSecret: "test-tenant-secret",
};
const sha = (data) => createHash("sha256").update(data).digest("hex");
function fixture(options = {}) {
	const web = Buffer.from("normalized-web-master");
	const original = Buffer.from("private-print-source");
	const records = {
		content: [
			{
				id: "doc",
				kind: "aboutPage",
				revisions: [
					{
						id: "rev",
						states: ["published", "draft"],
						payload: {
							biography: "Client-owned text",
							portraits: [{ assetId: "web-id", altText: "A mountain" }],
						},
					},
				],
			},
		],
		portfolio: [],
		products: [],
		web: [
			{
				id: "web-id",
				kind: "web",
				status: "ready",
				assetKey: "123e4567-e89b-42d3-a456-426614174000",
				originalFilename: "photo.jpg",
				mimeType: "image/webp",
				sizeBytes: web.length,
			},
		],
		print: [
			{
				id: "print-id",
				kind: "print_source",
				status: "ready",
				assetKey: "artwork-1",
				originalFilename: "artwork.jpg",
				mimeType: "image/jpeg",
				sizeBytes: original.length,
				sha256: sha(original),
			},
		],
		digital: [],
		uploads: [{ id: "unfinished", lifecycle: "expired" }],
	};
	let passes = 0;
	let downloads = 0;
	const client = {
		setAuth() {},
		async query(_, args) {
			if (args.family === "content" && !args.paginationOpts.cursor) passes++;
			const index = Number(args.paginationOpts.cursor ?? 0);
			const result = structuredClone(records[args.family].slice(index, index + 1));
			if (options.changed && passes > 1 && result.length) result[0].updatedAt = 999;
			return {
				siteUrl: options.wrongTenant ? "another.example" : config.siteUrl,
				tenantId: "tenant-1",
				page: result,
				isDone: index + 1 >= records[args.family].length,
				continueCursor: String(index + 1),
			};
		},
	};
	const fetcher = async (_, request) => {
		downloads++;
		const body = JSON.parse(request.body);
		assert.equal(body.siteUrl, config.siteUrl);
		assert.equal(request.redirect, "error");
		if (options.interrupt && downloads === 2) throw new Error("synthetic interruption");
		if (options.missing) return new Response(null, { status: 404 });
		const bytes = body.kind === "web" ? web : original;
		return new Response(
			options.corrupt && body.kind !== "web" ? Buffer.alloc(bytes.length) : bytes,
			{
				headers: {
					"Content-Type": body.kind === "web" ? "image/webp" : "image/jpeg",
					"Content-Length": String(bytes.length),
				},
			},
		);
	};
	return { client, fetcher, records, options, downloads: () => downloads };
}
async function temporary(fn) {
	const root = await mkdtemp(join(tmpdir(), "content-export-test-"));
	try {
		await fn(join(root, "export"));
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}
test("plan fully paginates current content and unused media without downloading", async () => {
	const f = fixture();
	for (let i = 0; i < 110; i++) f.records.content.push({ id: `doc-${i}`, revisions: [] });
	const plan = await run(config, "plan", undefined, f);
	assert.equal(plan.counts.content, 111);
	assert.equal(plan.mediaFiles, 2);
	assert.equal(f.downloads(), 0);
	assert.equal(plan.complete, false);
});
test("creates and reopens an actual ZIP with relative media paths and no credentials", async () =>
	temporary(async (output) => {
		const result = await run(config, "export", output, fixture());
		assert.equal(result.complete, true);
		const manifest = JSON.parse(await readFile(join(output, "package/manifest.json"), "utf8"));
		assert.equal(manifest.files.filter((file) => file.path.startsWith("media/")).length, 2);
		const text = await readFile(join(output, "package/content/content.json"), "utf8");
		assert.match(text, /mediaPath/);
		assert.doesNotMatch(text, /test-session|test-tenant-secret|privateObjectKey/);
		assert.equal((await stat(output)).mode & 0o077, 0);
	}));
test("resumes an interrupted export by verifying and reusing completed files", async () =>
	temporary(async (output) => {
		const f = fixture({ interrupt: true });
		await assert.rejects(run(config, "export", output, f), /interruption/);
		f.options.interrupt = false;
		assert.equal((await run(config, "resume", output, f)).complete, true);
		assert.equal(f.downloads(), 3);
	}));
for (const [option, message] of [
	["wrongTenant", /tenant mismatch/],
	["missing", /media unavailable/],
	["corrupt", /checksum/],
	["changed", /Content changed/],
])
	test(`${option} cannot produce a complete archive`, async () =>
		temporary(async (output) => {
			await assert.rejects(run(config, "export", output, fixture({ [option]: true })), message);
			await assert.rejects(stat(join(output, "content-export.zip")), { code: "ENOENT" });
		}));
test("unknown references and unsafe media identities block export", async () => {
	const f = fixture();
	f.records.web = [];
	await assert.rejects(run(config, "plan", undefined, f), /no retained ready media/);
	const g = fixture();
	g.records.print[0].assetKey = "../../secrets";
	await assert.rejects(run(config, "plan", undefined, g), /Unsafe asset/);
});
test("resume refuses locally corrupted completed bytes and changed source", async () =>
	temporary(async (output) => {
		const f = fixture({ interrupt: true });
		await assert.rejects(run(config, "export", output, f));
		await writeFile(
			join(output, "package/media/web/123e4567-e89b-42d3-a456-426614174000/master.webp"),
			"corrupt",
		);
		await assert.rejects(run(config, "resume", output, f), /checksum mismatch/);
		f.records.content[0].updatedAt = 42;
		await assert.rejects(run(config, "resume", output, f), /Source changed/);
	}));

test("empty advancing pages are bounded and repeated cursors are rejected", async () => {
	const f = fixture();
	f.client.query = async () => ({
		siteUrl: config.siteUrl,
		tenantId: "tenant-1",
		page: [],
		isDone: false,
		continueCursor: "stuck",
	});
	await assert.rejects(run(config, "plan", undefined, f), /pagination did not advance/);
});
test("a second export cannot overwrite an existing directory", async () =>
	temporary(async (output) => {
		await run(config, "export", output, fixture());
		await assert.rejects(run(config, "export", output, fixture()), { code: "EEXIST" });
	}));
test("chunked files are streamed through archive creation and reopen verification", async () =>
	temporary(async (output) => {
		const f = fixture();
		const chunk = Buffer.alloc(1024 * 1024, 45);
		const size = 32 * chunk.length;
		f.records.print = [];
		f.records.web[0].sizeBytes = size;
		f.fetcher = async () => {
			let count = 0;
			return new Response(
				new ReadableStream({
					pull(controller) {
						if (count++ === 32) controller.close();
						else controller.enqueue(chunk);
					},
				}),
				{ headers: { "Content-Type": "image/webp", "Content-Length": String(size) } },
			);
		};
		assert.equal((await run(config, "export", output, f)).complete, true);
	}));
