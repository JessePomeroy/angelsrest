import { expect, test } from "@playwright/test";

test("bottom navigation is a mobile landmark with route-aware links and usable targets", async ({
	page,
	isMobile,
}) => {
	await page.goto("/?fixture=navigation");
	const nav = page.getByRole("navigation", { name: "Mobile navigation", includeHidden: true });
	if (!isMobile) {
		await expect(nav).toBeHidden();
		return;
	}
	await expect(nav).toBeVisible();
	const links = nav.getByRole("link");
	await expect(links).toHaveCount(5);
	const destinations = [
		["Home", "/"],
		["Gallery", "/gallery"],
		["Blog", "/blog"],
		["Shop", "/shop"],
		["About", "/about"],
	];
	for (const [name, href] of destinations) {
		const link = nav.getByRole("link", { name, exact: true });
		await expect(link).toHaveAttribute("href", href);
		const box = await link.boundingBox();
		expect(box?.width).toBeGreaterThanOrEqual(44);
		expect(box?.height).toBeGreaterThanOrEqual(44);
	}
	for (const [path, active] of [
		["/", "Home"],
		["/gallery", "Gallery"],
		["/gallery/forest", "Gallery"],
		["/blog/story", "Blog"],
		["/shop/sets/forest", "Shop"],
		["/about", "About"],
		["/gallery-extra", ""],
		["/blogger", ""],
		["/shopping", ""],
		["/unknown", ""],
	]) {
		await page.getByLabel("Current path").fill(path);
		const current = nav.locator('[aria-current="page"]');
		await expect(current).toHaveCount(active ? 1 : 0);
		if (active) await expect(current).toHaveAccessibleName(active);
	}
});

test("navigation preserves time borders, keyboard focus and the desktop breakpoint", async ({ page }) => {
	await page.setViewportSize({ width: 767, height: 800 });
	await page.goto("/?fixture=navigation");
	const nav = page.getByRole("navigation", { name: "Mobile navigation" });
	const home = nav.getByRole("link", { name: "Home", exact: true });
	for (const mode of ["Light", "Dark"]) {
		await page.getByRole("button", { name: `${mode} mode`, exact: true }).click();
		for (const period of ["dawn", "morning", "afternoon", "golden", "evening", "night"]) {
			await page.evaluate((period) => { document.documentElement.dataset.timePeriod = period; }, period);
			const expected = await page.evaluate(() => {
				const probe = document.createElement("span");
				probe.style.color = "var(--time-border)";
				document.body.append(probe);
				const color = getComputedStyle(probe).color;
				probe.remove();
				return color;
			});
			await expect(nav).toHaveCSS("border-top-color", expected);
		}
		await page.getByLabel("Current path").focus();
		await page.keyboard.press("Tab");
		await expect(home).toBeFocused();
		await expect(home).toHaveCSS("outline-style", "solid");
		await expect(home).toHaveCSS("outline-width", "2px");
		await expect(home).toHaveCSS("outline-offset", "-2px");
	}
	await expect(nav).toBeVisible();
	await page.setViewportSize({ width: 768, height: 800 });
	await expect(nav).toBeHidden();
});
