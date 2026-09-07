import { expect, test } from "@playwright/test";

for (const kind of ["product", "set"]) {
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
