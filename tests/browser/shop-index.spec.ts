import { expect, test } from "@playwright/test";

test("shop filters current products and shows print sets in the Prints category", async ({ page }) => {
  await page.goto("/?fixture=shop");
  await expect(page.locator(".catalog-entry")).toHaveCount(6);
  await expect(page.getByRole("link", { name: /Fixture pair/ })).toHaveCount(0);

  await page.getByRole("tab", { name: "Prints", exact: true }).click();
  await expect(page.locator(".catalog-entry")).toHaveCount(5);
  await expect(page.getByRole("link", { name: /Fixture pair/ })).toHaveAttribute("href", "/shop/sets/fixture-pair");
  await expect(page.getByRole("link", { name: "Fixture print 1" })).toHaveAttribute("href", "/shop/fixture-print-1");

  for (const category of ["Merchandise", "Digital"]) {
    await page.getByRole("tab", { name: category, exact: true }).click();
    await expect(page.locator(".catalog-entry")).toHaveCount(1);
    await expect(page.getByRole("link", { name: `Fixture ${category.toLowerCase()}` })).toHaveAttribute("href", `/shop/fixture-${category.toLowerCase()}`);
  }

  await page.getByRole("tab", { name: "All", exact: true }).click();
  await expect(page.locator(".catalog-entry")).toHaveCount(6);
});

test("shop retains responsive product columns", async ({ page }) => {
  await page.goto("/?fixture=shop");
  for (const [width, columns] of [[767, "2"], [768, "3"], [1024, "3"]] as const) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator(".catalog-columns")).toHaveCSS("column-count", columns);
  }
});

test("shop retains empty category and empty catalog states", async ({ page }) => {
  await page.goto("/?fixture=shop");
  await page.getByRole("tab", { name: "Postcards", exact: true }).click();
  await expect(page.getByText("No products found in this category.", { exact: true })).toBeVisible();
  await expect(page.locator(".empty-state")).toHaveCSS("margin-top", "48px");
  await page.getByRole("tab", { name: "Prints", exact: true }).click();
  await expect(page.locator(".empty-state")).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Fixture pair/ })).toBeVisible();

  await page.goto("/?fixture=shop&empty=true");
  await expect(page.getByText("No products found in this category.", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Prints", exact: true }).click();
  await expect(page.getByText("No products found in this category.", { exact: true })).toBeVisible();
  await expect(page.locator(".catalog-entry")).toHaveCount(0);
});
