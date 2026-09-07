import { expect, test } from "@playwright/test";

test("fractional invoice displays the same rounded line, subtotal and tax amounts as checkout", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/?fixture=portal-css&kind=fractional");
  await expect(page.getByRole("cell", { name: "0.5", exact: true })).toHaveCount(2);
  await expect(page.getByRole("cell", { name: "$10.00", exact: true })).toHaveCount(2);
  await expect(page.locator(".invoice-totals")).toContainText("$20.00");
  await expect(page.locator(".invoice-totals")).toContainText("$1.25");
  await expect(page.locator(".total-amount")).toHaveText("$21.25");
  await expect(page.getByRole("button", { name: "Pay Now", exact: true })).toBeEnabled();
  expect(errors).toEqual([]);
});

test("invalid historical invoice stays readable and cannot initiate payment", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/?fixture=portal-css&kind=invalid-invoice");
  await expect(page.getByRole("heading", { name: "INV-FRACTION" })).toBeVisible();
  await expect(page.getByText(/Please contact the business for a corrected invoice/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Pay Now" })).toHaveCount(0);
  expect(errors).toEqual([]);
});

for (const kind of ["invoice", "quote", "contract"]) {
  test(`native foundation preserves ${kind} document styles and controls`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`/?fixture=portal-css&kind=${kind}`);
    for (const dark of [false, true]) {
      await page.evaluate(dark => document.documentElement.classList.toggle("dark", dark), dark);
      await expect(page.locator(".portal")).toHaveCSS("background-color", "rgb(250, 250, 250)");
      await expect(page.locator(".portal-card")).toHaveCSS("background-color", "rgb(255, 255, 255)");
      await expect(page.locator(".doc-header")).toHaveCSS("border-bottom-width", "1px");
      const button = page.getByRole("button", { name: /^(Pay Now|Accept Quote|Sign Contract)$/ });
      await expect(button).toHaveCSS("font-family", 'Synonym, system-ui, sans-serif');
      await expect(button).toHaveCSS("background-color", "rgb(79, 70, 229)");
    }
    if (kind === "invoice") {
      await expect(page.getByRole("table")).toHaveCSS("border-collapse", "collapse");
      await expect(page.getByText("$265.00", { exact: true })).toBeVisible();
    } else if (kind === "contract") {
      const sign = page.getByRole("button", { name: "Sign Contract", exact: true });
      await expect(sign).toBeDisabled();
      await page.getByLabel("Your full name", { exact: true }).fill("Fixture signer");
      await expect(sign).toBeEnabled();
    } else {
      await expect(page.getByRole("listitem")).toHaveCount(2);
      await expect(page.getByRole("button", { name: "Accept Quote", exact: true })).toBeEnabled();
    }
    expect(errors).toEqual([]);
  });
}
