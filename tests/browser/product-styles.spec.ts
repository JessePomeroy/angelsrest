import { expect, test } from "@playwright/test";

for (const scenario of ["physical", "postcard", "tapestry"]) {
  test(`${scenario} retains fixed-price cart and checkout without print selectors`, async ({ page }) => {
    let checkout: Record<string, unknown> | undefined;
    await page.route("**/api/checkout", async route => {
      checkout = route.request().postDataJSON();
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ url: `${page.url()}#checkout` }) });
    });
    await page.goto(`/?fixture=product-css&scenario=${scenario}`);
    await expect(page.getByLabel("Paper Type", { exact: true })).toHaveCount(0);
    const price = page.locator(".desktop-price, .merch-price").filter({ visible: true });
    await expect(price).toHaveText("$12.34");
    const add = page.getByRole("button", { name: "add to cart", exact: true }).filter({ visible: true });
    await add.focus();
    await expect(add).toHaveCSS("outline-width", "2px");
    await add.click();
    await add.click();
    const payload = JSON.parse(await page.getByLabel("Cart payload").textContent() ?? "[]");
    expect(payload).toEqual([{
      id: expect.any(String), productSlug: `fixture-merch-${scenario}`, type: "print",
      title: "Fixture merchandise", imageUrl: expect.any(String), unitPriceCents: 1234, quantity: 2,
    }]);
    await page.getByRole("button", { name: "buy now", exact: true }).filter({ visible: true }).click();
    await expect(page).toHaveURL(/#checkout$/);
    expect(checkout).toEqual({ productId: `fixture-merch-${scenario}`, coupon: null, isPrintSet: false });
  });
}

test("digital downloads retain direct checkout without joining the physical cart", async ({ page }) => {
  let checkout: Record<string, unknown> | undefined;
  await page.route("**/api/checkout", async route => {
    checkout = route.request().postDataJSON();
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ url: `${page.url()}#checkout` }) });
  });
  await page.goto("/?fixture=product-css&scenario=digital");
  await expect(page.getByRole("button", { name: "add to cart", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Paper Type", { exact: true })).toHaveCount(0);
  await expect(page.getByText("instant download after payment", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^(buy & download|download)$/ }).filter({ visible: true }).click();
  await expect(page).toHaveURL(/#checkout$/);
  expect(checkout).toEqual({ productId: "fixture-merch-digital", coupon: null, isPrintSet: false });
  await expect(page.getByLabel("Cart payload")).toHaveText("[]");
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
