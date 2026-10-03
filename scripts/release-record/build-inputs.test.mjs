import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	checkedOutSource,
	clientAssetsDigest,
	collectPackages,
	SHARED_PACKAGES,
} from "./build-inputs.mjs";

function fixture(t) {
	const root = mkdtempSync(join(tmpdir(), "release-build-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const write = (path, data) => {
		const file = join(root, path);
		mkdirSync(join(file, ".."), { recursive: true });
		writeFileSync(file, typeof data === "string" ? data : JSON.stringify(data));
	};
	return { root, write };
}

test("package evidence checks real installed bytes, lock resolution and workspace versions", (t) => {
	const { root, write } = fixture(t);
	write("package.json", { name: "host" });
	write("node_modules/@jessepomeroy/admin/package.json", {
		name: SHARED_PACKAGES[0],
		version: "6.7.1",
	});
	const projects = [
		{ name: "host", path: root, dependencies: { [SHARED_PACKAGES[0]]: { version: "6.7.1" } } },
	];
	for (const name of SHARED_PACKAGES.slice(1)) {
		const path = `packages/${name.split("/")[1]}`;
		write(`${path}/package.json`, { name, version: "1.2.3" });
		projects.push({ name, version: "1.2.3", path: join(root, path) });
		if (name !== "@jessepomeroy/crm-api") {
			projects[0].dependencies[name] = { version: `link:${path}` };
			symlinkSync(join(root, path), join(root, "node_modules", name));
		}
	}
	write("packages/admin-shadow/package.json", { name: SHARED_PACKAGES[0], version: "9.0.0" });
	projects.push({
		name: SHARED_PACKAGES[0],
		version: "9.0.0",
		path: join(root, "packages/admin-shadow"),
	});
	const execute = (_command, args) => {
		const result = structuredClone(projects);
		if (args.includes("--lockfile-only") && staleLock)
			result[0].dependencies[SHARED_PACKAGES[0]].version = "6.7.0";
		return JSON.stringify(result);
	};
	let staleLock = false;
	assert.deepEqual(collectPackages(root, execute)[0], {
		name: SHARED_PACKAGES[0],
		version: "6.7.1",
		source: "installed",
	});
	staleLock = true;
	assert.throws(() => collectPackages(root, execute), /lockfile/);
	staleLock = false;
	write("node_modules/@jessepomeroy/admin/package.json", {
		name: SHARED_PACKAGES[0],
		version: "6.7.0",
	});
	assert.throws(() => collectPackages(root, execute), /lockfile/);
	write("node_modules/@jessepomeroy/admin/package.json", {
		name: SHARED_PACKAGES[0],
		version: "6.7.1",
	});
	write("packages/crm-api/package.json", { name: SHARED_PACKAGES[1], version: "9.0.0" });
	assert.throws(() => collectPackages(root, execute), /Workspace package/);
});

test("client artifact identity changes for bytes and paths, excludes private server outputs", (t) => {
	const { root, write } = fixture(t);
	write(".svelte-kit/output/client/a.js", "public-a");
	write(".svelte-kit/output/server/private.js", "private-canary-one");
	const first = clientAssetsDigest(root);
	write(".svelte-kit/output/server/private.js", "private-canary-two");
	assert.deepEqual(clientAssetsDigest(root), first);
	write(".svelte-kit/output/client/a.js", "public-b");
	assert.notEqual(clientAssetsDigest(root).digest, first.digest);
	write(".svelte-kit/output/client/b.js", "public-b");
	assert.equal(clientAssetsDigest(root).fileCount, 2);
	assert.equal(JSON.stringify(clientAssetsDigest(root)).includes("private-canary"), false);
});

test("asset observation rejects links into private outputs and linked output parents", (t) => {
	const { root, write } = fixture(t);
	write(".svelte-kit/output/client/a.js", "public");
	write(".svelte-kit/output/server/private.js", "private-canary");
	symlinkSync("../server/private.js", join(root, ".svelte-kit/output/client/link.js"));
	assert.throws(() => clientAssetsDigest(root), /symbolic links/);
	rmSync(join(root, ".svelte-kit/output/client/link.js"));
	rmSync(join(root, ".svelte-kit/output/client"), { recursive: true });
	symlinkSync("server", join(root, ".svelte-kit/output/client"));
	assert.throws(() => clientAssetsDigest(root), /symbolic-link parents/);
});

test("CI source binding uses the actual checkout and rejects dirty or differently tested revisions", (t) => {
	const { root, write } = fixture(t);
	const git = (args) =>
		execFileSync("git", args, {
			cwd: root,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		}).trim();
	git(["init", "--quiet"]);
	write("package.json", { name: "fixture" });
	git(["add", "package.json"]);
	git([
		"-c",
		"user.name=Fixture",
		"-c",
		"user.email=fixture@example.test",
		"commit",
		"--quiet",
		"-m",
		"fixture",
	]);
	const head = git(["rev-parse", "HEAD"]);
	assert.equal(checkedOutSource(root, head), head);
	assert.throws(() => checkedOutSource(root, "a".repeat(40)), /actual checkout/);
	write("untracked.js", "changed");
	assert.throws(() => checkedOutSource(root, head), /unchanged checkout/);
});
