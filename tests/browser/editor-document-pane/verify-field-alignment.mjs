import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";

// Run against the existing fictional source preview; no provider writes occur.
const captures = await mkdtemp(join(tmpdir(), "editor-field-alignment-"));
const browser = await chromium.launch();
const failures = [];
const routes = [
	...["print", "print_set", "postcard", "merchandise", "tapestry", "digital_download"].map((kind) => ({ route: "products/demo-product-1", kind })),
	...[
		"portfolio/demo-portfolio-1", "blog/posts/demo-post-1", "blog/authors/demo-author-1",
		"blog/categories/demo-category-1", "pages/about", "pages/contact",
	].map((route) => ({ route })),
];
let checked = 0;
try {
	for (const theme of ["light", "dark"]) {
		for (const width of [390, 1600]) {
			const page = await browser.newPage({ viewport: { width, height: 1100 }, reducedMotion: "reduce" });
			page.setDefaultTimeout(5_000);
			page.on("pageerror", (error) => failures.push(error.message));
			for (const { route, kind } of routes) {
				const context = `${route} ${kind ?? ""} ${width} ${theme}`;
				try {
					await page.goto(`http://127.0.0.1:5208/?route=/admin/editor/${route}&state=populated&theme=${theme}${kind ? `&kind=${kind}` : ""}`);
					await page.locator(".editor-document").waitFor();
					await page.evaluate(() => document.fonts.ready);
					const geometry = await page.locator(".editor-document").evaluate((root) => {
						const rect = (element) => {
							const box = element.getBoundingClientRect();
							return { x: box.x, y: box.y, width: box.width, height: box.height };
						};
						const rows = [...root.querySelectorAll(".fields")].flatMap((group) => {
							const fields = [...group.children].map((field) => {
								const input = field.querySelector('input:not([type="file"]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), textarea, select');
								return input && input.getBoundingClientRect().width > 0 ? { field: rect(field), input: rect(input) } : null;
							}).filter(Boolean);
							return fields.flatMap((field, index) => fields.slice(index + 1).filter((other) => Math.abs(field.field.y - other.field.y) < 1 && Math.abs(field.input.x - other.input.x) > 1).map((other) => Math.abs(field.input.y - other.input.y)));
						});
						const title = root.querySelector("#product-identity-heading")?.closest("section")?.querySelector("input");
						const alt = root.querySelector(".product-media li > label > input");
						return {
							rows, overflow: document.documentElement.scrollWidth > window.innerWidth,
							title: title && rect(title), alt: alt && rect(alt),
							uploads: [...root.querySelectorAll(".product-media .uploader, .private-file-dropzone")].map(rect).filter((box) => box.width > 0),
							contentWidth: root.clientWidth - parseFloat(getComputedStyle(root).paddingLeft) - parseFloat(getComputedStyle(root).paddingRight),
						};
					});
					assert.equal(geometry.overflow, false, "page overflow");
					for (const difference of geometry.rows) assert.ok(difference <= 1, `paired controls differ by ${difference}px`);
					for (const upload of geometry.uploads) {
						assert.ok(upload.width <= 577, `upload width ${upload.width}px`);
						if (geometry.contentWidth >= 768 && geometry.title) assert.ok(Math.abs(upload.x - geometry.title.x) <= 1, "upload and detail columns differ");
					}
					if (geometry.contentWidth >= 768 && geometry.title && geometry.alt) assert.ok(Math.abs(geometry.alt.x - geometry.title.x) <= 1, "image metadata and detail columns differ");
					if (kind === "digital_download" || route.includes("authors/")) await page.screenshot({ path: join(captures, `${kind ?? "author"}-${width}-${theme}.png`), fullPage: true });
					checked++;
				} catch (error) { failures.push(`${context}: ${error.message}`); }
			}
			await page.close();
		}
	}
} finally { await browser.close(); }
console.log(JSON.stringify({ checked, captures, failures }, null, 2));
assert.equal(failures.length, 0, "Editor field alignment checks failed");
