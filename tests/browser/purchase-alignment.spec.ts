import { expect, test } from "@playwright/test";

for (const kind of ["product", "set"]) {
 test(`${kind} retains purchase sizing and focus with enlarged text and portrait or landscape chrome`, async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/?fixture=chrome&purchase=true&kind=${kind}`);
  await page.getByLabel("Frame", { exact: true }).selectOption("0.875-black");
  await page.evaluate(() => document.documentElement.style.fontSize = "200%");
  const bar = page.locator(".sticky-bar");
  const add = page.getByRole("button", { name: "add to cart", exact: true }).filter({ visible: true });
  const buy = page.getByRole("button", { name: "buy now", exact: true }).filter({ visible: true });
  for (const mode of ["light", "dark"]) {
   await page.evaluate(mode => document.documentElement.classList.toggle("dark", mode === "dark"), mode);
   await expect(add).toHaveCount(1);
   await expect(buy).toHaveCount(1);
   for (const button of [add, buy]) {
    const box = await button.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    await button.focus();
    await expect(button).toHaveCSS("outline-width", "2px");
   }
   await page.locator(".sticky-sentinel").evaluate(element => element.scrollIntoView({ block: "center" }));
   await expect(bar).not.toHaveClass(/\bstuck\b/);
   await page.screenshot({ path: testInfo.outputPath(`${mode}-large-inline.png`), scale: "css" });
   await page.evaluate(() => window.scrollTo(0, 0));
   await expect(bar).toHaveClass(/\bstuck\b/);
   await page.screenshot({ path: testInfo.outputPath(`${mode}-large-stuck.png`), scale: "css" });
  }
  await page.setViewportSize({ width: 874, height: 402 });
  await expect(bar).toBeHidden();
  await expect(add).toHaveCount(1);
  await expect(buy).toHaveCount(1);
  await expect(page.locator(".desktop-actions")).toHaveCSS("flex-shrink", kind === "set" ? "0" : "1");
  await buy.scrollIntoViewIfNeeded();
  await expect(buy).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("large-landscape.png"), scale: "css" });
  await page.evaluate(() => document.documentElement.style.removeProperty("font-size"));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  const nav = page.locator(".bottom-nav");
  await expect.poll(async () => {
   const [n, b] = await Promise.all([nav.boundingBox(), bar.boundingBox()]);
   return n && b ? Math.abs(n.y - (b.y + b.height)) : Infinity;
  }).toBeLessThanOrEqual(1);
 });

 test(`${kind} purchase bar aligns with content and uses equal themed touch targets`, async ({ page }, testInfo) => {
  await page.setViewportSize({width:390,height:844});
  await page.goto(`/?fixture=print&kind=${kind}`);
  const bar=page.locator(".sticky-bar"), cart=bar.getByRole("button",{name:"add to cart",exact:true}),buy=bar.getByRole("button",{name:"buy now",exact:true});
  await expect(cart).toBeVisible();
  const boxes=await Promise.all([bar.boundingBox(),cart.boundingBox(),buy.boundingBox(),page.locator('.configuration').boundingBox()]);
  const [b,c,p,config]=boxes;
  expect(c!.x).toBeCloseTo(config!.x,1);
  expect(b!.x).toBeCloseTo(c!.x,1);
  expect(c!.width).toBeCloseTo(p!.width,1);
  expect(c!.height).toBeGreaterThanOrEqual(44);
  expect(p!.height).toBeGreaterThanOrEqual(44);
  await expect(cart).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
  await expect(cart).toHaveCSS('border-top-width','1px');
  await page.screenshot({path:testInfo.outputPath('purchase-light.png'),scale:'css'});
  for(const mode of ['light','dark']) {
   await page.evaluate(mode=>document.documentElement.classList.toggle('dark',mode==='dark'),mode);
   await page.evaluate(()=>document.documentElement.setAttribute('data-time-period','morning'));
   const morning=await buy.evaluate(e=>getComputedStyle(e).backgroundColor);
   await page.evaluate(()=>document.documentElement.setAttribute('data-time-period','evening'));
   await expect.poll(()=>buy.evaluate(e=>getComputedStyle(e).backgroundColor)).not.toBe(morning);
   await page.screenshot({path:testInfo.outputPath(`purchase-${mode}.png`),scale:'css'});
  }
 });
}
