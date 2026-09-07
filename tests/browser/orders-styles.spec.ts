import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
  await page.addInitScript(() => {
    let input: HTMLInputElement;
    Object.defineProperty(window, "turnstile", { value: {
      render(node: HTMLElement, options: { callback: (token: string) => void }) {
        input = document.createElement("input"); input.type = "hidden"; input.name = "cf-turnstile-response";
        const button = document.createElement("button"); button.type = "button"; button.textContent = "Verify fixture";
        button.onclick = () => { input.value = "fixture-token"; options.callback("fixture-token"); };
        node.append(input, button); return "orders-fixture";
      }, reset() { input.value = ""; }, remove() {},
    } });
  });
});

test("order status presentation updates across every supported status and fallback", async ({ page }) => {
  let status = "new";
  await page.route("**/api/orders/lookup", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ order: { orderNumber: "ORD-FIXTURE", status, items: [{ productName: "Fixture print", quantity: 2, price: 2500 }], total: 5000 } }) }));
  await page.goto("/?fixture=orders");
  await page.getByLabel("Email", { exact: true }).fill("buyer@example.invalid");
  await page.getByLabel("Order Number", { exact: true }).fill("ORD-FIXTURE");
  const colors = new Map<string, string>();
  for (const value of ["new", "printing", "ready", "shipped", "delivered", "refunded", "unknown"]) {
    status = value;
    await page.getByRole("button", { name: "Verify fixture" }).click();
    await page.getByRole("button", { name: "Track Order", exact: true }).click();
    const badge = page.locator(".status-badge");
    await expect(badge).toHaveAttribute("data-status", value);
    await expect(badge).toHaveText(value === "unknown" ? value : value[0].toUpperCase() + value.slice(1));
    await expect(badge).toHaveCSS("color", ["printing", "ready"].includes(value) ? "rgb(0, 0, 0)" : "rgb(255, 255, 255)");
    colors.set(value, await badge.evaluate(element => getComputedStyle(element).backgroundColor));
    await expect(page.getByText("Total: $50.00", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Track Order", exact: true })).toBeDisabled();
  }
  expect(colors.get("printing")).toBe(colors.get("ready"));
  expect(new Set(colors.values()).size).toBe(6);
  expect(colors.get("unknown")).toBe("oklch(0.446 0.03 256.802)");
});

test("verification controls retain their disabled color even when hovered", async ({ page }) => {
  await page.goto("/?fixture=orders");
  const submit = page.getByRole("button", { name: "Track Order", exact: true });
  await expect(submit).toBeDisabled();
  await expect(page.getByRole("button", { name: "Verify fixture" }).locator("..")).toHaveCSS("margin-bottom", "12px");
  await submit.hover();
  await expect(submit).toHaveCSS("background-color", "oklch(0.446 0.03 256.802)");
  await expect(submit).toHaveCSS("opacity", "0.5");
  await page.getByRole("button", { name: "Verify fixture" }).click();
  await expect(submit).toBeEnabled();
  await expect(submit).toHaveCSS("opacity", "1");
});
