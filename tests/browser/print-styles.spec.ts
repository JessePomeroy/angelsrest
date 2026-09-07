import { expect, test } from "@playwright/test";

test("print-set controls retain focus, finish state, child spacing and responsive actions", async ({ page }) => {
	await page.goto("/?fixture=print&kind=set");
	const material = page.getByLabel("Material", { exact: true });
	await material.focus();
	await expect(material).toHaveCSS("outline-width", "2px");
	await expect(material).toHaveCSS("outline-offset", "2px");
	await expect(page.locator(".configuration")).toHaveCSS("margin-bottom", "24px");
	await page.getByLabel("Frame", { exact: true }).selectOption("0.875-black");
	await expect(page.getByLabel("Border", { exact: true })).toBeDisabled();
	await expect(page.getByText("border included with frame")).toBeVisible();
	await expect(page.getByLabel("Border", { exact: true })).toHaveCSS("opacity", "0.5");
	await page.setViewportSize({ width: 767, height: 900 });
	await expect(page.locator(".desktop-purchase")).toBeHidden();
	await expect(page.getByRole("button", { name: "add to cart", exact: true }).filter({ visible: true })).toHaveCount(1);
	await page.setViewportSize({ width: 768, height: 900 });
	await expect(page.locator(".desktop-purchase")).toBeVisible();
	await expect(page.getByRole("button", { name: "add to cart", exact: true }).filter({ visible: true })).toHaveCount(1);
	await page.getByRole("button", { name: "no-images", exact: true }).click();
	await expect(page.getByText("No images", { exact: true })).toBeVisible();
	const placeholder = await page.locator(".empty-images").boundingBox();
	if (!placeholder) throw new Error("Missing image placeholder");
	expect(placeholder.width).toBeCloseTo(placeholder.height, 1);
});

test("sticky purchase bar keeps observer states, class and bottom offset", async ({ page, isMobile }) => {
	test.skip(!isMobile, "Mobile-only purchase bar");
	await page.emulateMedia({ colorScheme: "light" });
	await page.goto("/?fixture=sticky");
	const bar = page.locator(".fixture-sticky");
	await expect(bar).toHaveCSS("position", "sticky");
	await expect(bar).toHaveCSS("bottom", "24px");
	await expect(page.getByLabel("Sticky state")).toHaveText("stuck");
	await expect(bar).toHaveClass(/stuck/);
	await page.evaluate(() => window.scrollTo(0, 500));
	await expect(page.getByLabel("Sticky state")).toHaveText("inline");
	await expect(bar).not.toHaveClass(/\bstuck\b/);
	await page.evaluate(() => window.scrollTo(0, 0));
	await expect(page.getByLabel("Sticky state")).toHaveText("stuck");
	await page.setViewportSize({ width: 768, height: 900 });
	await expect(bar).toBeHidden();
});
