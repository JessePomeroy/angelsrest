import { expect, test } from "@playwright/test";
import { computedColor } from "./computedColor";

for (const kind of ["standard", "behindTheScenes", "caseStudy", "clientStory", "technical"]) {
	test(`${kind} preserves readable rich text in light and dark`, async ({ page }) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
		await page.goto(`/?fixture=blog&kind=${kind}`);
		const body = page.locator(".article-body");
		await expect(body.getByRole("heading", { name: "Looking for the light" })).toBeVisible();
		await expect(body.locator("ul")).toHaveCSS("list-style-type", "disc");
		await expect(body.locator("ul ol")).toHaveCSS("list-style-type", "decimal");
		await expect(body.locator("blockquote")).toHaveCSS("border-inline-start-width", "4px");
		await expect(body.getByRole("link", { name: "our field notes" })).toHaveAttribute("href", "#field-notes");
		await expect(body.getByRole("link")).toHaveCSS("text-decoration-line", "underline");
		await expect(body.locator("figcaption")).toHaveText("A quiet moment beside the water.");
		await expect(body.locator("figcaption")).toHaveCSS("text-align", "center");
		await expect(body.locator("img")).toHaveAttribute("loading", "lazy");
		await expect(body.locator("img")).toHaveCSS("margin-top", "0px");
		await expect(body.locator(":scope > :last-child")).toHaveCSS("margin-bottom", "0px");
		const geometry = await body.evaluate((element) => {
			const style = getComputedStyle(element);
			const figure = element.querySelector("figure");
			if (!figure) throw new Error("Figure missing");
			return { font: style.fontFamily, size: Number.parseFloat(style.fontSize), figureMargin: Number.parseFloat(getComputedStyle(figure).marginTop), height: element.getBoundingClientRect().height };
		});
		if (kind === "technical") {
			expect(geometry.font).toContain("ui-monospace");
			expect(geometry.figureMargin).toBeCloseTo(geometry.size * 2, 2);
			await page.setViewportSize({ width: 767, height: 900 });
			await expect(page.locator(".equipment-grid")).toHaveCSS("grid-template-columns", /^\S+ \S+$/);
			await page.setViewportSize({ width: 768, height: 900 });
			await expect(page.locator(".equipment-grid")).toHaveCSS("grid-template-columns", /^\S+ \S+ \S+ \S+$/);
		} else if (kind === "behindTheScenes") {
			expect(geometry.font).toContain("ui-serif");
			expect(geometry.size).toBe(18);
		}
		await expect(body).toHaveCSS("color", await computedColor(page, "oklch(0.373 0.034 259.733)"));
		await page.evaluate(() => document.documentElement.classList.add("dark"));
		await expect(body).toHaveCSS("color", await computedColor(page, "oklch(0.872 0.01 258.338)"));
		await expect(body.getByRole("link")).toHaveCSS("color", "rgb(255, 255, 255)");
		expect(errors).toEqual([]);
	});
}

test("blog listing handles populated and empty content", async ({ page }) => {
	await page.goto("/?fixture=blog&kind=index");
	await expect(page.getByRole("link", { name: /An afternoon by the water/i })).toHaveAttribute("href", "/blog/afternoon");
	await page.goto("/?fixture=blog&kind=empty");
	await expect(page.getByText("no posts yet — check back soon!")).toBeVisible();
	await expect(page.getByText("0 entries")).toBeVisible();
});
