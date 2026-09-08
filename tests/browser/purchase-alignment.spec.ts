import { expect, test } from "@playwright/test";

for (const kind of ["product", "set"]) {
 test(`${kind} enlarged purchase summary and actions remain reachable in a narrow short viewport`, async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
  await page.setViewportSize({ width: 320, height: 500 });
  await page.goto(`/?fixture=chrome&purchase=true&kind=${kind}`);
  await page.getByLabel("Frame", { exact: true }).selectOption("0.875-black");
  await page.evaluate(() => {
   document.documentElement.style.fontSize = "200%";
   window.scrollTo(0, 0);
  });
  const bar = page.locator(".sticky-bar");
  await expect(bar).toHaveClass(/\bstuck\b/);
  await expect.poll(() => bar.evaluate(element => element.scrollHeight - element.clientHeight)).toBeGreaterThan(0);
  const box = await bar.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(320);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  const summary = bar.locator(".mobile-selection");
  await expect(summary).toContainText("frame");
  await summary.scrollIntoViewIfNeeded();
  await expect(summary).toBeInViewport({ ratio: 1 });
  const add = bar.getByRole("button", { name: "add to cart", exact: true });
  const buy = bar.getByRole("button", { name: "buy now", exact: true });
  await add.focus();
  for (const button of [add, buy]) {
   await expect(button).toBeFocused();
   await expect(button).toBeInViewport({ ratio: 1 });
   await expect(button).toHaveCSS("outline-width", "2px");
   await expect(button).toHaveCSS("outline-style", "solid");
   await expect(button).not.toHaveCSS("outline-color", "rgba(0, 0, 0, 0)");
   expect(await button.evaluate(element => {
    const action = element.getBoundingClientRect();
    return element.contains(document.elementFromPoint(action.x + action.width / 2, action.y + action.height / 2));
   })).toBe(true);
   if (button === add) await page.keyboard.press("Tab");
  }
  expect(await bar.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await page.keyboard.press("Shift+Tab");
  await expect(add).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
 });

 test(`${kind} retains purchase sizing and focus with enlarged text and portrait or landscape chrome`, async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/?fixture=chrome&purchase=true&kind=${kind}`);
  await page.getByLabel("Frame", { exact: true }).selectOption("0.875-black");
  await page.evaluate(() => {
   document.documentElement.style.fontSize = "200%";
   window.scrollTo(0, 0);
  });
  const bar = page.locator(".sticky-bar");
  const add = page.getByRole("button", { name: "add to cart", exact: true }).filter({ visible: true });
  const buy = page.getByRole("button", { name: "buy now", exact: true }).filter({ visible: true });
  await expect(bar).toHaveClass(/\bstuck\b/);
  // Check before focus/scroll can hide an initially off-screen purchase action.
  for (const button of [add, buy]) {
   await expect.poll(async () => {
    const [action, nav] = await Promise.all([button.boundingBox(), page.locator(".bottom-nav").boundingBox()]);
    return !!action && !!nav && action.y >= 0 && action.y + action.height <= nav.y;
   }).toBe(true);
   expect(await button.evaluate(element => {
    const box = element.getBoundingClientRect();
    return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
   })).toBe(true);
  }
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
