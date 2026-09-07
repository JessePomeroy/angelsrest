import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { shouldSkipBuild } from "./vercel-ignore-build.mjs";

function repo(t) {
	const cwd = mkdtempSync(join(tmpdir(), "angelsrest-deploy-gate-"));
	t.after(() => rmSync(cwd, { recursive: true, force: true }));
	const git = (...args) =>
		execFileSync("git", args, {
			cwd,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
	git("init");
	git("config", "user.name", "Fixture");
	git("config", "user.email", "fixture@example.invalid");
	function commit(path) {
		mkdirSync(dirname(join(cwd, path)), { recursive: true });
		writeFileSync(join(cwd, path), "fixture\n");
		git("add", ".");
		git("commit", "-m", "fixture");
		return git("rev-parse", "HEAD");
	}
	return { cwd, git, commit };
}

test("skips documentation/test changes since the last successful deployment", (t) => {
	const r = repo(t),
		base = r.commit("src/app.ts");
	r.commit("docs/guide.md");
	r.commit("tests/smoke.spec.ts");
	assert.equal(shouldSkipBuild({ VERCEL_GIT_PREVIOUS_SHA: base }, r.cwd), true);
	assert.equal(
		shouldSkipBuild({ VERCEL_GIT_PREVIOUS_SHA: base, VERCEL_FORCE_BUILD: "1" }, r.cwd),
		false,
	);
});
test("an earlier runtime change cannot be hidden by a later docs commit", (t) => {
	const r = repo(t),
		base = r.commit("README.md");
	r.commit("src/app.ts");
	r.commit("docs/guide.md");
	assert.equal(shouldSkipBuild({ VERCEL_GIT_PREVIOUS_SHA: base }, r.cwd), false);
});
test("unknown files, runtime markdown and build configuration always build", (t) => {
	for (const file of ["src/post.md", "package.json", "vercel.json", "scripts/build.mjs"]) {
		const r = repo(t),
			base = r.commit("README.md");
		r.commit(file);
		assert.equal(shouldSkipBuild({ VERCEL_GIT_PREVIOUS_SHA: base }, r.cwd), false, file);
	}
});
test("missing history and intentional same-commit redeploys build", (t) => {
	const r = repo(t),
		base = r.commit("README.md");
	for (const previous of [undefined, "bad", "0".repeat(40), base])
		assert.equal(shouldSkipBuild({ VERCEL_GIT_PREVIOUS_SHA: previous }, r.cwd), false);
});
test("deleting runtime files still requires a deployment", (t) => {
	const r = repo(t),
		base = r.commit("src/app.ts");
	r.git("rm", "src/app.ts");
	r.git("commit", "-m", "remove fixture");
	assert.equal(shouldSkipBuild({ VERCEL_GIT_PREVIOUS_SHA: base }, r.cwd), false);
});
