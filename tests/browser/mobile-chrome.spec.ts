import { expect, test } from "@playwright/test";

const product = "/?fixture=chrome&purchase=true&kind=product";

test("phone navigation remains reachable after rotation on a scrolled product", async ({page, isMobile}) => {
 test.skip(!isMobile, "Phone rotation uses touch input");
 test.setTimeout(60000); // Software WebGL may need extra time to settle the open orbit.
 await page.setViewportSize({width:402,height:874});
 await page.emulateMedia({reducedMotion:"no-preference"});
 await page.goto(product);
 const sphere=page.getByRole("button",{name:"Open navigation",exact:true});
 await expect(sphere).toBeInViewport();
 await page.evaluate(()=>window.scrollTo(0,500));
 await page.setViewportSize({width:874,height:402});
 await expect(sphere).toBeInViewport();
 await sphere.tap();
 await expect.poll(()=>page.locator("#water-nav-links").evaluate(e=>Number(getComputedStyle(e).opacity)), {timeout:15000}).toBeGreaterThan(0.99);
 const nav=page.getByRole("navigation",{name:"Mobile navigation"});
 for(const name of ["Gallery","Shop","About","Home","Blog"]) await expect(nav.getByRole("link",{name,exact:true})).toBeInViewport({ratio:1});
 await nav.getByRole("button",{name:"Close navigation",exact:true}).tap();
 await page.emulateMedia({reducedMotion:"reduce"});
 await expect(page.locator('.bottom-nav')).toBeInViewport();
});

test("purchase bar meets square bottom navigation under reduced motion", async ({page, isMobile}) => {
 test.skip(!isMobile, "Mobile purchase controls");
 await page.setViewportSize({width:402,height:874});
 await page.emulateMedia({reducedMotion:"reduce"});
 await page.goto(product);
 const nav=page.locator('.bottom-nav'),bar=page.locator('.sticky-bar');
 await expect(bar).toBeInViewport();
 await expect.poll(async()=>{const n=await nav.boundingBox(),b=await bar.boundingBox();return n&&b?Math.abs(n.y-(b.y+b.height)):Infinity;}).toBeLessThanOrEqual(1);
 await expect(nav.locator('[aria-current="page"]')).toHaveCSS("border-radius","0px");
 // Content resizing must not restore a gap through a guessed nav height.
 await nav.locator('a').evaluateAll(links=>links.forEach(link=>(link as HTMLElement).style.paddingBlock="14px"));
 await expect.poll(async()=>{const n=await nav.boundingBox(),b=await bar.boundingBox();return n&&b?Math.abs(n.y-(b.y+b.height)):Infinity;}).toBeLessThanOrEqual(1);
});

test("sphere and purchase controls occupy separate space across motion changes", async ({page,isMobile})=>{
 test.skip(!isMobile,"Mobile purchase controls");
 await page.setViewportSize({width:402,height:874});
 await page.emulateMedia({reducedMotion:"no-preference"});
 await page.goto(product);
 const sphere=page.locator('.sphere'),bar=page.locator('.sticky-bar');
 await expect(sphere).toBeInViewport();
 await expect(bar).toHaveCSS('bottom','0px');
 await expect.poll(async()=>{const s=await sphere.boundingBox(),b=await bar.boundingBox();return s&&b?b.y-(s.y+s.height):-Infinity;}).toBeGreaterThanOrEqual(0);
 await sphere.focus();
 for (let step=0;step<8;step++) await page.keyboard.press("ArrowDown");
 await expect.poll(async()=>{const s=await sphere.boundingBox(),b=await bar.boundingBox();return s&&b?b.y-(s.y+s.height):-Infinity;}).toBeGreaterThanOrEqual(0);
 await page.emulateMedia({reducedMotion:"reduce"});
 await expect(sphere).toHaveCount(0);
 const nav=page.locator('.bottom-nav');
 await expect.poll(async()=>{const n=await nav.boundingBox(),b=await bar.boundingBox();return n&&b?Math.abs(n.y-(b.y+b.height)):Infinity;}).toBeLessThanOrEqual(1);
 await page.emulateMedia({reducedMotion:"no-preference"});
 await expect(sphere).toBeInViewport();
 await expect(bar).toHaveCSS('bottom','0px');
});

test("renderer load failure keeps bottom navigation flush with the purchase bar", async ({page,isMobile})=>{
 test.skip(!isMobile,"Mobile renderer fallback");
 await page.setViewportSize({width:402,height:874});
 await page.emulateMedia({reducedMotion:"no-preference"});
 let blocked = false;
 await page.route('**/JellyNav.svelte*',route=>{ blocked = true; return route.abort(); });
 await page.goto(product);
 const nav=page.locator('.bottom-nav'),bar=page.locator('.sticky-bar');
 await expect.poll(()=>blocked).toBe(true);
 await expect(nav).toBeInViewport();
 await expect(nav.getByRole('link')).toHaveCount(5);
 await expect.poll(async()=>{const n=await nav.boundingBox(),b=await bar.boundingBox();return n&&b?Math.abs(n.y-(b.y+b.height)):Infinity;}).toBeLessThanOrEqual(1);
});
