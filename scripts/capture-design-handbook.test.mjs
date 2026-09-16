import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { chromium } from "@playwright/test";
import { captureHandbookPage } from "./capture-design-handbook.mjs";

test("captures visible fixed descendants and rendered text without exposing hidden content", async (t) => {
	const output = await fs.mkdtemp(path.join(os.tmpdir(), "angelsrest-handbook-test-"));
	t.after(() => fs.rm(output, { recursive: true, force: true }));
	const browser = await chromium.launch();
	t.after(() => browser.close());
	const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
	await page.route("**/*", (route) => route.abort());
	await page.setContent(`<!doctype html><html><body style="margin:0;font:16px/24px Arial">
		<style>a.active::before { content:""; position:absolute; left:-2px; top:7px; width:3px; height:23px; background:rgb(249,204,89); }</style>
		<main>
			<input type="password" value="fake-password-only" /><input type="password" placeholder="At least 8 characters" />
			<details><summary>Collapsed disclosure</summary><div>Hidden disclosure content</div></details>
			<a class="active" style="display:block;position:relative;width:100px;height:37px">Editor selection</a>
			<div style="display:contents"><p id="hard-breaks">Alpha<br>Beta<br>Gamma</p></div>
			<p id="clamped" style="width:100px;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden">One two three four five six seven eight nine ten eleven twelve.</p>
			<p style="width:170px">Before some <strong>bold words wrap here</strong> afterwards.</p>
			<div style="position:fixed;left:0;top:0;width:0;height:0;overflow:visible"><button style="position:absolute;left:220px;top:5px;width:100px">Anchored control</button></div>
			<textarea style="width:150px;font:16px/24px Arial">First paragraph\n\nSecond paragraph</textarea>
			<p style="position:absolute;width:1px;height:1px;clip:rect(0,0,0,0);overflow:hidden">Screen-reader-only heading</p>
			<svg id="icon" viewBox="0 0 24 24" style="width:24px;height:24px;fill:none;stroke:rgb(10,20,30)"><path d="M2 2L22 22"/></svg>
			<div style="margin-top:1200px"><div id="purchase-panel" style="position:fixed;bottom:60px;left:16px;width:358px;height:80px;background:#123;color:white">Purchase controls</div></div>
			<div style="display:none">Not rendered</div>
		</main>
	</body></html>`);
	const result = await captureHandbookPage(page, output, "capture-seam");
	const html = result.fragments
		.flatMap((fragment) => [fragment.html, ...fragment.childHtml])
		.join("");
	assert.equal(result.verificationStatus, "unverified");
	assert.match(html, /Purchase controls/);
	assert.match(html, /Active editor navigation marker[^>]*left:-2px;top:7px;width:3px;height:23px/);
	assert.match(html, /Alpha\nBeta\nGamma/);
	assert.doesNotMatch(html, /Screen-reader-only heading|Not rendered/);
	assert.doesNotMatch(html, /Hidden disclosure content/);
	assert.match(html, /Collapsed disclosure/);
	assert.match(html, /At least 8 characters/);
	assert.doesNotMatch(html, /fake-password-only/);
	assert.match(html, /Native disclosure indicator/);
	assert.match(html, /layer-name="strong line 1"/);
	assert.match(html, /layer-name="strong line 2"/);
	assert.match(html, /Anchored\s+control/);
	assert.match(html, /First paragraph\n\nSecond paragraph/);
	const excerpt = html.match(/layer-name="clamped"[^>]*>([^<]*)<\/div>/)?.[1];
	assert.equal(excerpt?.split("\n").length, 2);
	assert.ok(excerpt?.endsWith("…"));
	assert.doesNotMatch(excerpt, /eleven twelve/);
	assert.match(html, /<path[^>]*style="[^"]*fill: none;[^"]*stroke: rgb\(10, 20, 30\)/);
	await fs.access(path.join(output, "capture-seam.png"));
	const saved = JSON.parse(await fs.readFile(path.join(output, "capture-seam.json"), "utf8"));
	assert.deepEqual(saved.viewport, { width: 390, height: 844 });
});

test("keeps modal layers outside clipping ancestors and preserves editable control cues", async (t) => {
	const output = await fs.mkdtemp(path.join(os.tmpdir(), "angelsrest-handbook-layers-"));
	t.after(() => fs.rm(output, { recursive: true, force: true }));
	const browser = await chromium.launch();
	t.after(() => browser.close());
	const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
	await page.route("**/*", (route) => route.abort());
	await page.setContent(`<!doctype html><html><body style="margin:0;font:16px/24px Arial">
		<style>dialog::backdrop { background:rgba(0,0,0,.5); }</style>
		<main style="margin-left:20px;width:250px;height:250px;overflow:hidden">
			<div role="dialog" aria-modal="true" aria-label="Shared modal" style="position:fixed;inset:0;background:white">
				<button id="centered" style="min-height:44px">Save</button>
				<ul><li>Editable bullet</li></ul>
				<input id="date" type="date" />
			</div>
			<dialog aria-label="Native modal"><p>Top-layer content</p><button>Close</button></dialog>
		</main>
	</body></html>`);
	await page.locator("dialog").evaluate((dialog) => dialog.showModal());
	const result = await captureHandbookPage(page, output, "modal-seam");
	for (const name of ["Shared modal", "Native modal", "Native modal backdrop"]) {
		const layer = result.fragments.find((fragment) => fragment.name === name);
		assert.ok(layer, `Missing ${name}`);
		assert.equal(layer.parentKey, null, `${name} must escape ancestor clipping`);
	}
	const html = result.fragments
		.flatMap((fragment) => [fragment.html, ...fragment.childHtml])
		.join("");
	assert.match(html, /layer-name="centered"[^>]*align-items:center;justify-content:center/);
	assert.match(html, /layer-name="List marker"/);
	assert.match(html, /layer-name="Native calendar indicator"/);
	assert.match(html, /Top-layer content/);
});
