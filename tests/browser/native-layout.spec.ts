import { expect, test } from "@playwright/test";

test("decorative gradient stays bounded to the viewport after resize", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?fixture=chrome");
  for (const viewport of [{ width: 412, height: 839 }, { width: 1280, height: 720 }]) {
    await page.setViewportSize(viewport);
    const box = await page.locator(".gradient-background").boundingBox();
    expect(box).toEqual({ x: 0, y: 0, ...viewport });
    await expect(page.locator(".gradient-background")).toHaveCSS("pointer-events", "none");
  }
});

test("invoice payment result pages retain their responsive content widths", async ({ page }) => {
  for (const kind of ["payment-success", "payment-canceled"]) {
    await page.goto(`/?fixture=portal-css&kind=${kind}`);
    for (const [width, expectedWidth] of [[600, 600], [800, 768], [1100, 1024], [1400, 1280], [1600, 1536]]) {
      await page.setViewportSize({ width, height: 900 });
      const box = await page.locator(".payment-page").boundingBox();
      expect(box?.width).toBe(expectedWidth);
    }
    await expect(page.getByRole("heading", { name: kind === "payment-success" ? "payment received" : "payment canceled" })).toBeVisible();
  }
});
