import { expect, test } from "@playwright/test";

test("merchandise paper selection retains cart and checkout fields", async ({ page }) => {
  let checkout: Record<string, unknown> | undefined;
  await page.route("**/api/checkout", async route => {
    checkout = route.request().postDataJSON();
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ url: `${page.url()}#checkout` }) });
  });
  await page.goto("/?fixture=product-css&scenario=paper");
  const paper = page.getByLabel("Paper Type", { exact: true });
  await paper.focus();
  await expect(paper).toHaveCSS("outline-width", "2px");
  await paper.selectOption("1");
  await page.getByRole("button", { name: "add to cart", exact: true }).filter({ visible: true }).click();
  const payload = JSON.parse(await page.getByLabel("Cart payload").textContent() ?? "[]");
  expect(payload).toHaveLength(1);
  expect(payload[0]).toMatchObject({ productSlug: "fixture-merch-paper", paperIndex: 1, paperWidth: 5, paperHeight: 7, paperSubcategoryId: 103002, unitPriceCents: 2000 });
  await page.getByRole("button", { name: "buy now", exact: true }).filter({ visible: true }).click();
  await expect(page).toHaveURL(/#checkout$/);
  expect(checkout).toEqual({ productId: "fixture-merch-paper", coupon: null, isPrintSet: false, paperIndex: 1 });
});

test("digital and sold-out products retain their purchase restrictions", async ({ page }) => {
  await page.route("**/api/checkout", async route => {
    await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Fixture checkout unavailable" }) });
  });
  await page.goto("/?fixture=product-css&scenario=digital");
  await expect(page.getByRole("button", { name: "add to cart", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Paper Type", { exact: true })).toHaveCount(0);
  const buy = page.getByRole("button", { name: /^(buy & download|download)$/ }).filter({ visible: true });
  await buy.click();
  await expect(buy).toBeEnabled();
  await page.getByRole("button", { name: "sold-out", exact: true }).click();
  await expect(page.getByRole("button", { name: "add to cart", exact: true })).toHaveCount(0);
  const unavailable = page.getByRole("button", { name: /^(out of stock|sold out)$/ }).filter({ visible: true });
  await expect(unavailable).toBeDisabled();
  await unavailable.hover();
  await expect(unavailable).toHaveCSS("opacity", "0.5");
});

test("product thumbnails open the selected lightbox image and restore keyboard focus", async ({ page }) => {
  await page.goto("/?fixture=product-css");
  const thumbnail = page.getByRole("button", { name: "Product view 2", exact: true });
  await thumbnail.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("img", { name: "Product view 2", exact: true })).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(dialog.getByRole("img", { name: "Product view 3", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(thumbnail).toBeFocused();
});

test("product layout retains the purchase breakpoint, shared spacing and empty-image square", async ({ page }) => {
  await page.goto("/?fixture=print&kind=product");
  await expect(page.locator(".configuration")).toHaveCSS("margin-bottom", "24px");
  await page.setViewportSize({ width: 767, height: 900 });
  await expect(page.locator(".desktop-purchase")).toBeHidden();
  await expect(page.getByRole("button", { name: "buy now", exact: true }).filter({ visible: true })).toHaveCount(1);
  await page.setViewportSize({ width: 768, height: 900 });
  await expect(page.locator(".desktop-purchase")).toBeVisible();
  await expect(page.getByRole("button", { name: "buy now", exact: true }).filter({ visible: true })).toHaveCount(1);
  await page.getByRole("button", { name: "no-images", exact: true }).click();
  const placeholder = page.getByText("No image available", { exact: true });
  await expect(placeholder).toBeVisible();
  const rect = await page.locator(".empty-images").boundingBox();
  if (!rect) throw new Error("Missing image placeholder");
  expect(rect.width).toBeCloseTo(rect.height, 1);
});
