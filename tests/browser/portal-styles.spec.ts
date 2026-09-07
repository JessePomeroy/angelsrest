import { expect, test } from "@playwright/test";

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
