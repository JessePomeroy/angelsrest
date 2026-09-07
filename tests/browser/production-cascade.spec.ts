import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

// SvelteKit can emit a shared component stylesheet before the root stylesheet.
// Replay that order using the real document's styles and real component CSS.
test("component-first CSS retains cart spacing and mobile purchase padding", async ({ page }, testInfo) => {
 const shell = readFileSync(new URL("../../src/app.html", import.meta.url), "utf8");
 const beforeHead = shell.split("%sveltekit.head%")[0];
 const shellStyles = beforeHead.match(/<style\b[^>]*>[\s\S]*?<\/style>/g)?.join("") ?? "";
 await page.route("http://127.0.0.1:5196/?**", async route => {
  const response = await route.fetch();
  const html = await response.text();
  await route.fulfill({response, body:html.replace("<head>", `<head>${shellStyles}<style>@layer components;</style>`)});
 });
 await page.setViewportSize({width:402,height:874});
 await page.goto("/?fixture=cart-css&kind=drawer&state=filled");
 await page.getByRole("button", {name:"Open cart fixture"}).click();
 await expect(page.locator(".drawer-header")).toHaveCSS("padding-left", "24px");
 await expect(page.locator(".drawer-footer")).toHaveCSS("padding-top", "20px");
 await expect(page.locator(".cart-line").first()).toHaveCSS("padding-top", "16px");
 await expect(page.locator(".cart-sheet")).toHaveCSS("opacity", "1");
 await expect(page.locator(".drawer-footer")).toBeInViewport();
 await testInfo.attach("cart-production-css-order", {body:await page.screenshot({path:testInfo.outputPath("cart.png"), scale:"css"}), contentType:"image/png"});
 await page.emulateMedia({reducedMotion:"reduce"});
 await page.goto("/?fixture=chrome&purchase=true&kind=product");
 await expect(page.locator(".sticky-bar")).toHaveCSS("padding-top", "8px");
 await expect.poll(() => page.evaluate(() => getComputedStyle(document.querySelector(".bottom-nav")!).borderTopColor === getComputedStyle(document.querySelector(".sticky-bar")!).backgroundColor)).toBe(true);
 await testInfo.attach("purchase-production-css-order", {body:await page.screenshot({path:testInfo.outputPath("purchase.png"), scale:"css"}), contentType:"image/png"});
});
