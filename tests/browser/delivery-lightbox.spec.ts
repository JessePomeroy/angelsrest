import { expect, test } from "@playwright/test";
import { contentSecurityPolicy } from "../../src/lib/config/securityPolicy";

const longName = "2026-09-08_family_portraits_at_the_botanical_gardens_001";
const tinyMp4 = Buffer.from(
	"AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAANcbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAAHgAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAod0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAAHgAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAABAAAAAQAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAB4AAAEAAABAAAAAAH/bWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAyAAAABgBVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABqm1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAWpzdGJsAAAAvnN0c2QAAAAAAAAAAQAAAK5hdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAABAAEABIAAAASAAAAAAAAAABFExhdmM2My4xLjEwMSBsaWJ4MjY0AAAAAAAAAAAAAAAAGP//AAAANGF2Y0MBZAAK/+EAF2dkAAqs2V7ARAAAAwAEAAADAMg8SJZYAQAGaOvjyyLA/fj4AAAAABBwYXNwAAAAAQAAAAEAAAAUYnRydAAAAAAAAL7iAAAAAAAAABhzdHRzAAAAAAAAAAEAAAADAAACAAAAABRzdHNzAAAAAAAAAAEAAAABAAAAKGN0dHMAAAAAAAAAAwAAAAEAAAQAAAAAAQAABgAAAAABAAACAAAAABxzdHNjAAAAAAAAAAEAAAABAAAAAwAAAAEAAAAgc3RzegAAAAAAAAAAAAAAAwAAAsUAAAAMAAAADAAAABRzdGNvAAAAAAAAAAEAAAOMAAAAYXVkdGEAAABZbWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAbWRpcmFwcGwAAAAAAAAAAAAAAAAsaWxzdAAAACSpdG9vAAAAHGRhdGEAAAABAAAAAExhdmY2My4xLjEwMQAAAAhmcmVlAAAC5W1kYXQAAAKuBgX//6rcRem95tlIt5Ys2CDZI+7veDI2NCAtIGNvcmUgMTY1IHIzMjIyIGIzNTYwNWEgLSBILjI2NC9NUEVLTDQgQVZDIGNvZGVjIC0gQ29weWxlZnQgMjAwMy0yMDI1IC0gaHR0cDovL3d3dy52aWRlb2xhbi5vcmcveDI2NC5odG1sIC0gb3B0aW9uczogY2FiYWM9MSByZWY9MyBkZWJsb2NrPTE6MDowIGFuYWx5c2U9MHgzOjB4MTEzIG1lPWhleCBzdWJtZT03IHBzeT0xIHBzeV9yZD0xLjAwOjAuMDAgbWl4ZWRfcmVmPTEgbWVfcmFuZ2U9MTYgY2hyb21hX21lPTEgdHJlbGxpcz0xIDh4OGRjdD0xIGNxbT0wIGRlYWR6b25lPTIxLDExIGZhc3RfcHNraXA9MSBjaHJvbWFfcXBfb2Zmc2V0PS0yIHRocmVhZHM9MSBsb29rYWhlYWRfdGhyZWFkcz0xIHNsaWNlZF90aHJlYWRzPTAgbnI9MCBkZWNpbWF0ZT0xIGludGVybGFjZWQ9MCBibHVyYXlfY29tcGF0PTAgY29uc3RyYWluZWRfaW50cmE9MCBiZnJhbWVzPTMgYl9weXJhbWlkPTIgYl9hZGFwdD0xIGJfYmlhcz0wIGRpcmVjdD0xIHdlaWdodGI9MSBvcGVuX2dvcD0wIHdlaWdodHA9MiBrZXlpbnQ9MjUwIGtleWludF9taW49MjUgc2NlbmVjdXQ9NDAgaW50cmFfcmVmcmVzaD0wIHJjX2xvb2thaGVhZD00MCByYz1jcmYgbWJ0cmVlPTEgY3JmPTIzLjAgcWNvbXA9MC42MCBxcG1pbj0wIHFwbWF4PTY5IHFwc3RlcD00IGlwX3JhdGlvPTEuNDAgYXE9MToxLjAwAIAAAAAPZYiEADP//vbsvgU2FMjBAAAACEGaImxCv/7AAAAACAGeQXkK/8SB",
	"base64",
);

type LightboxCase = {
	name: string;
	filename: string;
	raw: boolean;
	video?: boolean;
	downloads: boolean;
	favorites: boolean;
	portrait?: boolean;
};

const cases: LightboxCase[] = [
	{ name: "long RAW", filename: `${longName}.raf`, raw: true, downloads: true, favorites: true },
	{ name: "long image", filename: `${longName}.jpg`, raw: false, downloads: true, favorites: true },
	{ name: "portrait image", filename: `${longName}.jpg`, raw: false, downloads: true, favorites: true, portrait: true },
	{ name: "ordinary image", filename: "photo-1.jpg", raw: false, downloads: true, favorites: true },
	{ name: "video", filename: "ceremony.mp4", raw: false, video: true, downloads: true, favorites: true },
	{ name: "owner archive", filename: "project-files.zip", raw: true, downloads: true, favorites: true },
	{ name: "download-only video", filename: "ceremony.mkv", raw: true, downloads: true, favorites: false },
	{ name: "download only", filename: `${longName}.raf`, raw: true, downloads: true, favorites: false },
	{ name: "favorite only", filename: `${longName}.raf`, raw: true, downloads: false, favorites: true },
	{ name: "no actions", filename: `${longName}.raf`, raw: true, downloads: false, favorites: false },
];

test.beforeEach(async ({ page }) => {
	await page.route("**/*", async (route) => {
		const request = route.request();
		const url = new URL(request.url());
		if (url.origin === "http://127.0.0.1:5196") {
			if (request.resourceType() !== "document") return route.continue();
			const response = await route.fetch();
			return route.fulfill({
				response,
				headers: { ...response.headers(), "content-security-policy": contentSecurityPolicy },
			});
		}
		if (url.origin === "https://gallery-worker.thinkingofview.workers.dev") {
			return route.fulfill({
				status: 200,
				contentType: "video/mp4",
				headers: { "Accept-Ranges": "bytes", "Cache-Control": "private, no-store" },
				body: tinyMp4,
			});
		}
		await route.abort();
		throw new Error("Unexpected external request in delivery lightbox fixture");
	});
});

for (const scenario of cases) {
	test(`delivery lightbox controls fit before interaction: ${scenario.name}`, async ({ page }, testInfo) => {
		const params = new URLSearchParams({
			fixture: "delivery-downloads", filename: scenario.filename,
			downloads: String(scenario.downloads), favorites: String(scenario.favorites),
		});
		if (scenario.raw) params.set("raw", "");
		if (scenario.video) params.set("video", "");
		if (scenario.portrait) params.set("portrait", "");
		for (const viewport of [{ width: 320, height: 568 }, { width: 393, height: 852 }, { width: 1280, height: 900 }]) {
			await page.setViewportSize(viewport);
			await page.goto(`/?${params}`);
			const opener = page.getByRole("button", { name: "View item 1 of 4", exact: true });
			await opener.click();
			const dialog = page.getByRole("dialog", { name: "Gallery lightbox" });
			await expect(dialog.locator(".lightbox-counter")).toHaveText("1 / 4");
			await expect(dialog.locator(".lightbox-filename")).toHaveText(scenario.filename);
			const preview = dialog.getByRole("img");
			const video = dialog.locator("video");
			await expect(preview).toHaveCount(scenario.raw || scenario.video ? 0 : 1);
			await expect(video).toHaveCount(scenario.video ? 1 : 0);
			if (scenario.video) {
				await expect(video).toHaveAttribute("controls", "");
				await expect(video).toHaveAttribute("playsinline", "");
				await expect(video).toHaveAttribute("preload", "metadata");
				await expect(video).toHaveAttribute("aria-label", `Video preview: ${scenario.filename}`);
				await expect(video).toHaveAttribute("src", /gallery-worker\.thinkingofview\.workers\.dev\/image\/fixture-0\.mp4/);
				await expect.poll(() => video.evaluate((element: HTMLVideoElement) => ({
					readyState: element.readyState,
					width: element.videoWidth,
					height: element.videoHeight,
				}))).toEqual({ readyState: 4, width: 16, height: 16 });
				await video.focus();
				await page.keyboard.press("ArrowRight");
				await expect(dialog.locator(".lightbox-counter")).toHaveText("1 / 4");
			} else if (!scenario.raw) {
				await expect.poll(() => preview.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
			}
			const download = dialog.getByRole("link", { name: "Download original file" });
			const favorite = dialog.getByRole("button", { name: "Remove from favorites" });
			await expect(download).toHaveCount(Number(scenario.downloads));
			await expect(favorite).toHaveCount(Number(scenario.favorites));

			// Measure every control before focus/trial-click helpers can scroll it into view.
			const geometry = await dialog.locator(".lightbox-counter, .lightbox-filename, button, a").evaluateAll((elements) =>
				elements.map((element) => {
					const rect = element.getBoundingClientRect();
					const interactive = element.matches("button, a");
					return {
						name: element.getAttribute("aria-label") ?? element.className,
						fits: rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
						hit: !interactive || element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)),
					};
				}),
			);
			expect(geometry.filter((item) => !item.fits || !item.hit)).toEqual([]);
			expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
			if (scenario.downloads) {
				await expect(download).toHaveAttribute("href", "/fixture-download/0");
				await download.click({ trial: true });
			}
			if (scenario.favorites) await favorite.click({ trial: true });
			const close = dialog.getByRole("button", { name: "Close lightbox" });
			await close.focus();
			await page.keyboard.press("Tab");
			await expect.poll(() => dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
			await page.keyboard.press("Shift+Tab");
			await expect(close).toBeFocused();
			if (scenario.name === "long RAW" || scenario.name === "long image" || scenario.name === "owner archive" || scenario.name === "download-only video" || scenario.portrait || scenario.video) {
				await page.screenshot({ path: testInfo.outputPath(`lightbox-${viewport.width}.png`) });
			}
			await page.keyboard.press("Escape");
			await expect(dialog).toHaveCount(0);
			await expect(opener).toBeFocused();
		}
	});
}
