import { expect, type Locator, test } from "@playwright/test";

async function contrast(element: Locator, pseudo?: string) {
	return element.evaluate((node, pseudo) => {
		const style = getComputedStyle(node, pseudo);
		const canvas = document.createElement("canvas");
		canvas.width = canvas.height = 1;
		const context = canvas.getContext("2d");
		if (!context) throw new Error("Canvas color conversion unavailable");
		function luminance(color: string) {
			if (!context) throw new Error("Canvas color conversion unavailable");
			context.clearRect(0, 0, 1, 1);
			// Composite translucent selection over this fixture's page background.
			context.fillStyle = getComputedStyle(document.body).backgroundColor;
			context.fillRect(0, 0, 1, 1);
			context.fillStyle = color;
			context.fillRect(0, 0, 1, 1);
			const [r, g, b, alpha] = context.getImageData(0, 0, 1, 1).data;
			if (alpha < 255) throw new Error(`Expected opaque contrast color: ${color}`);
			const linear = [r, g, b].map((value) => {
				const channel = value / 255;
				return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
			});
			return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
		}
		const fg = luminance(style.color);
		const bg = luminance(style.backgroundColor);
		return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
	}, pseudo);
}

test.beforeEach(async ({ page }) => {
	await page.route("**/*", async (route) => {
		const url = new URL(route.request().url());
		if (url.origin === "http://127.0.0.1:5196") await route.continue();
		else {
			await route.abort();
			throw new Error(`Unexpected external request: ${url.origin}`);
		}
	});
});

test("real theme switch updates muted copy, filled action, selection and cart label", async ({
	page,
}) => {
	await page.goto("/?fixture=theme&populated=true");
	const colors: string[] = [];
	for (const mode of ["Light", "Dark"]) {
		await page.getByRole("button", { name: `${mode} mode`, exact: true }).click();
		const copy = page.getByText("No worries!", { exact: false });
		await expect
			.poll(() =>
				copy.evaluate(
					(node) => getComputedStyle(node).color !== getComputedStyle(document.body).color,
				),
			)
			.toBe(true);
		colors.push(await copy.evaluate((node) => getComputedStyle(node).color));
		const back = page.getByRole("link", { name: "Back to Shop", exact: true });
		await expect(back).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
		await expect.poll(() => contrast(back)).toBeGreaterThanOrEqual(4.5);
		for (const period of [null, "afternoon"]) {
			await page.locator("html").evaluate((html, period) => {
				if (period) html.dataset.timePeriod = period;
				else delete html.dataset.timePeriod;
			}, period);
			await expect.poll(() => contrast(copy, "::selection")).toBeGreaterThanOrEqual(4.5);
		}
		await page.getByRole("button", { name: "Open cart", exact: true }).click();
		const checkout = page
			.getByRole("dialog")
			.getByRole("button", { name: "checkout", exact: true });
		await expect(checkout).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
		await expect.poll(() => contrast(checkout)).toBeGreaterThanOrEqual(4.5);
		await expect
			.poll(() =>
				checkout
					.locator("span")
					.evaluate(
						(span) =>
							getComputedStyle(span).color === getComputedStyle(span.parentElement ?? span).color,
					),
			)
			.toBe(true);
		await page.keyboard.press("Escape");
	}
	expect(colors[0]).not.toBe(colors[1]);
	await expect(page.locator("html")).toHaveAttribute("data-time-period", "afternoon");
});

for (const mode of ["Light", "Dark"]) {
	test(`real print set ${mode.toLowerCase()} controls have usable focus, options and disabled state`, async ({
		page,
	}) => {
		await page.goto("/?fixture=set");
		await page.getByRole("button", { name: `${mode} mode`, exact: true }).click();
		const size = page.getByLabel("Size", { exact: true });
		await expect(size).toHaveValue("8x10");
		await size.focus();
		await expect(size).toBeFocused();
		await expect
			.poll(() => size.evaluate((node) => getComputedStyle(node).outlineStyle))
			.not.toBe("none");
		await expect.poll(() => contrast(size.locator("option").first())).toBeGreaterThanOrEqual(4.5);
		await size.selectOption("11x14");
		await expect(size).toHaveValue("11x14");
		const buy = page
			.getByRole("button", { name: "buy now", exact: true })
			.filter({ visible: true });
		await expect(buy).toBeEnabled();
		await expect(buy).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
		await expect.poll(() => contrast(buy)).toBeGreaterThanOrEqual(4.5);
		await page.goto("/?fixture=set&stock=false");
		await page.getByRole("button", { name: `${mode} mode`, exact: true }).click();
		const disabled = page
			.getByRole("button", { name: "out of stock", exact: true })
			.filter({ visible: true });
		await expect(disabled).toBeDisabled();
		await expect(disabled).toHaveCSS("cursor", "not-allowed");
		await expect
			.poll(() => disabled.evaluate((node) => Number(getComputedStyle(node).opacity)))
			.toBeLessThan(1);
	});
}
