import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    return url.origin === "http://127.0.0.1:5196" ? route.continue() : route.abort();
  });
});

test("published admin edits preserve received money and agree with the customer portal", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/?fixture=invoice-verification");
  await expect(page.getByText("Remaining balance", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Pay Now", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Open admin invoice" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("document")).toBeInViewport({ ratio: 0.9 });
  await expect(dialog.getByText("remaining balance", { exact: true })).toBeVisible();
  await expect(dialog.getByText("$100.00", { exact: true })).toHaveCount(2);
  await dialog.getByRole("button", { name: "edit", exact: true }).click();
  await page.getByRole("spinbutton", { name: "Unit price", exact: true }).fill("250");
  await dialog.getByRole("button", { name: "save changes", exact: true }).click();
  await expect(dialog.getByText("$150.00", { exact: true })).toBeVisible();
  await expect(dialog.getByText("$100.00", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("admin-partial.png"), fullPage: true, animations: "disabled" });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("$150.00", { exact: true })).toBeVisible();
  await expect(page.getByText("$100.00", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("portal-partial.png"), fullPage: true, animations: "disabled" });

  await page.getByRole("button", { name: "Open admin invoice" }).click();
  await dialog.getByRole("button", { name: "edit", exact: true }).click();
  await page.getByRole("spinbutton", { name: "Unit price", exact: true }).fill("999");
  await dialog.getByRole("button", { name: "cancel", exact: true }).click();
  await expect(dialog.getByText("$150.00", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Close dialog", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("$150.00", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("admin and portal expose overpayment and prevent further portal collection", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/?fixture=invoice-verification&kind=overpaid");
  await expect(page.getByText(/Overpayment: \$100.00/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Pay Now", exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("portal-overpaid.png"), fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "Open admin invoice" }).click();
  await expect(page.getByRole("dialog").getByRole("document")).toBeInViewport({ ratio: 0.9 });
  await expect(page.getByRole("dialog").getByRole("status")).toContainText("overpayment: $100.00");
  await expect(page.getByRole("dialog").getByText("$300.00", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("admin-overpaid.png"), fullPage: true, animations: "disabled" });
  expect(errors).toEqual([]);
});
