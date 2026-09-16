import { expect, test } from "@playwright/test";
import sharp from "sharp";

test("lightbox controls remain readable over a white image", async ({ page }) => {
	const whiteImage = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="white"/></svg>')}`;
	await page.goto(`/?fixture=content&kind=gallery&portfolio-image=${encodeURIComponent(whiteImage)}`);
	await page.getByRole("button", { name: "Open portfolio lightbox" }).click();
	const image = page.locator(".lightbox img");
	await expect(image).toHaveAttribute("src", whiteImage);
	await image.evaluate(image => (image as HTMLImageElement).decode());
	for (const selector of [".image-previous", ".image-next", ".image-count", ".close-lightbox"]) {
		const control = page.locator(selector);
		await expect(control).toHaveCSS("color", "rgb(255, 255, 255)");
		const screenshot = await control.screenshot({ scale: "css" });
		const { data, info } = await sharp(screenshot).removeAlpha().raw().toBuffer({ resolveWithObject: true });
		// Sample the rendered backing above the glyph, inside its rounded edge.
		const offset = (3 * info.width + Math.floor(info.width / 2)) * info.channels;
		const channels = [...data.subarray(offset, offset + 3)].map(channel => {
			const value = channel / 255;
			return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
		});
		const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
		expect(1.05 / (luminance + 0.05), `${selector} contrast against its rendered backing`).toBeGreaterThanOrEqual(4.5);
	}
});
