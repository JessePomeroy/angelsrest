import { expect, test } from "@playwright/test";

test("floating navigation icons sustain bounded idle motion and suspend when hidden", async ({ page }) => {
 await page.setViewportSize({width:390,height:844});
 await page.emulateMedia({reducedMotion:"no-preference"});
 await page.clock.install();
 await page.goto('/?fixture=liquid-navigation');
 await expect(page.locator('.sphere')).toBeVisible();
 await page.clock.runFor(3000);
 const before=await page.locator('.floating-icon').evaluateAll(icons=>icons.map(icon=>icon.getAttribute('style')));
 await page.evaluate(() => {
  let updates = 0;
  const observer = new MutationObserver(records => { updates += records.length; });
  observer.observe(document.querySelector('.floating-icon')!, { attributes: true, attributeFilter: ['style'] });
  Object.defineProperty(window, 'idleIconUpdates', { get: () => updates });
 });
 await page.clock.runFor(1000);
 const after=await page.locator('.floating-icon').evaluateAll(icons=>icons.map(icon=>icon.getAttribute('style')));
 expect(after).not.toEqual(before);
 const updates=await page.evaluate(()=>Number(Reflect.get(window,'idleIconUpdates')));
 expect(updates).toBeGreaterThan(0);
 expect(updates).toBeLessThanOrEqual(31);
 // Drive the document-visibility boundary while the fixture clock keeps advancing.
 const hidden = await page.evaluate(async ()=>{
  Object.defineProperty(document,'hidden',{configurable:true,value:true});
  document.dispatchEvent(new Event('visibilitychange'));
  await Promise.resolve();
  return [...document.querySelectorAll('.floating-icon')].map(icon=>icon.getAttribute('style'));
 });
 await page.clock.runFor(1000);
 expect(await page.locator('.floating-icon').evaluateAll(icons=>icons.map(icon=>icon.getAttribute('style')))).toEqual(hidden);
 await page.evaluate(()=>{
  Object.defineProperty(document,'hidden',{configurable:true,value:false});
  document.dispatchEvent(new Event('visibilitychange'));
 });
 await page.clock.runFor(300);
 expect(await page.locator('.floating-icon').evaluateAll(icons=>icons.map(icon=>icon.getAttribute('style')))).not.toEqual(hidden);
});
