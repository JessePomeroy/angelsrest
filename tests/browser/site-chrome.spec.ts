import { expect, test } from "@playwright/test";

test("public chrome preserves responsive spacing, skip link and cart access", async ({ page, isMobile }) => {
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.goto("/?fixture=chrome&populated=true");
	const main = page.locator("#main-content");
	await expect(main).toBeVisible();
	await expect(main).toHaveCSS("padding-top", isMobile ? "24px" : "32px");
	await expect(main).toHaveCSS("padding-inline-start", isMobile ? "16px" : "40px");
	await expect(main).toHaveCSS("padding-bottom", isMobile ? "32px" : "48px");
	await page.keyboard.press("Tab");
	const skip = page.getByRole("link", { name: "Skip to content" });
	await expect(skip).toBeFocused();
	await expect(skip).toBeInViewport();
	await expect(skip).toHaveAttribute("href", "#main-content");
	const desktopNav = page.getByRole("navigation", { name: "Main navigation", includeHidden: true });
	const mobileNav = page.getByRole("navigation", { name: "Mobile navigation", includeHidden: true });
	await expect(isMobile ? mobileNav : desktopNav).toBeVisible();
	await expect(isMobile ? desktopNav : mobileNav).toBeHidden();
	const cart = page.getByRole("button", { name: "Open cart, 1 item", exact: true }).filter({ visible: true });
	if (isMobile) {
		const bounds = await cart.boundingBox();
		expect(bounds?.width).toBeGreaterThanOrEqual(44);
		expect(bounds?.height).toBeGreaterThanOrEqual(44);
	}
	await cart.click();
	await expect(page.getByRole("dialog")).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(cart).toBeFocused();
	await page.setViewportSize({ width: 1600, height: 900 });
	await expect(main).toHaveCSS("width", "1400px");
	expect((await main.boundingBox())?.x).toBe(100);
});
