import { expect, test } from "@playwright/test";

test("collection layout preserves breakpoints, breadcrumbs and destinations", async ({ page }) => {
  await page.goto("/?fixture=collection-css");
  await expect(page.getByRole("link", { name: "Parent collection", exact: true })).toHaveAttribute("href", "/shop/prints/parent-collection");
  await expect(page.getByRole("link", { name: "Nested collection" })).toHaveAttribute("href", "/shop/prints/nested-collection");
  await expect(page.getByRole("link", { name: /Fixture pair/ })).toHaveAttribute("href", "/shop/sets/fixture-pair");
  await expect(page.getByRole("link", { name: "Fixture print 1" })).toHaveAttribute("href", "/shop/fixture-print-1");
  for (const [width, padding, columns] of [[767, "8px", "2"], [768, "32px", "3"], [1024, "40px", "3"]] as const) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator(".collection-page")).toHaveCSS("padding-left", padding);
    await expect(page.locator(".collection-columns").last()).toHaveCSS("column-count", columns);
  }
});

test("collection hover keeps the time accent and image scale", async ({ page, isMobile }) => {
  test.skip(isMobile, "Desktop hover");
  await page.goto("/?fixture=collection-css");
  const entry = page.getByRole("link", { name: "Fixture print 1" });
  for (const [period, color] of [["dawn", "rgb(249, 168, 212)"], ["night", "rgb(165, 180, 252)"]] as const) {
    await page.evaluate(period => { document.documentElement.classList.remove("dark"); document.documentElement.dataset.timePeriod = period; }, period);
    await entry.hover();
    await expect(entry.locator(".entry-card")).toHaveCSS("border-top-color", color);
    await expect(entry.locator(".entry-card")).toHaveCSS("opacity", "0.85");
    await expect(entry.locator("img")).toHaveCSS("scale", "1.05");
  }
});

test("shop category filtering and empty collection retain their messages", async ({ page }) => {
  await page.goto("/?fixture=collection-css&kind=shop");
  await page.getByRole("tab", { name: "Digital", exact: true }).click();
  await expect(page.locator(".empty-state")).toBeVisible();
  await expect(page.locator(".empty-state")).toHaveCSS("margin-top", "48px");
  await page.getByRole("tab", { name: "Prints", exact: true }).click();
  await expect(page.locator(".empty-state")).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Fixture pair/ })).toBeVisible();
  await page.goto("/?fixture=collection-css&empty=true");
  await expect(page.getByText("No prints available in this collection yet.", { exact: true })).toBeVisible();
});
