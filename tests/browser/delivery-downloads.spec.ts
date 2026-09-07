import { expect, test } from "@playwright/test";

declare global {
 interface Window {
  downloadFixture: { mode: "success" | "failure" | "stream" | "picker"; fetched: string[]; saved: string[]; aborted: number; streamCanceled: number; releasePicker?: () => void; forms: Record<string, string>[] };
 }
}

test.beforeEach(async ({ page }) => {
 await page.route("**/*", async route => {
  if (new URL(route.request().url()).origin === "http://127.0.0.1:5196") return route.continue();
  await route.abort();
  throw new Error(`Unexpected external request: ${route.request().url()}`);
 });
 await page.addInitScript(() => {
  const state = window.downloadFixture = { mode: "success", fetched: [], saved: [], aborted: 0, streamCanceled: 0, forms: [] } as Window["downloadFixture"];
  const directory = {
   async getFileHandle(name: string, options?: { create?: boolean }) {
    if (!options?.create) throw new DOMException("Missing", "NotFoundError");
    return { async createWritable() { return {
     async write() {}, async close() { state.saved.push(name); }, async abort() { state.aborted++; },
    }; } };
   },
  };
  Object.defineProperty(window, "showDirectoryPicker", { configurable: true, value: async () => {
   if (state.mode === "picker") await new Promise<void>(resolve => { state.releasePicker = resolve; });
   return directory;
  } });
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, options) => {
   const url = String(input);
   if (!url.startsWith("/fixture-download/")) return originalFetch(input, options);
   state.fetched.push(url);
   if (state.mode === "failure") return new Response("failed", { status: 500 });
   if (state.mode === "stream") return new Response(new ReadableStream({ cancel() { state.streamCanceled++; } }));
   return new Response("fixture bytes");
  };
  HTMLFormElement.prototype.submit = function () {
   state.forms.push(Object.fromEntries([...new FormData(this)].map(([key, value]) => [key, String(value)])));
  };
 });
});

test("selected and favorite downloads preserve their targets and can retry failures", async ({ page }) => {
 await page.goto("/?fixture=delivery-downloads");
 await page.getByLabel("choose location", { exact: true }).check();
 await page.getByLabel("Select photo-3.jpg", { exact: true }).check();
 await page.getByRole("button", { name: "download selected (1)", exact: true }).click();
 await expect(page.getByRole("status")).toHaveText("saved 1 file.");
 expect(await page.evaluate(() => window.downloadFixture.saved)).toEqual(["photo-3.jpg"]);
 await page.getByRole("button", { name: "download favorites (2)", exact: true }).click();
 await expect(page.getByRole("status")).toHaveText("saved 2 files.");
 expect(await page.evaluate(() => window.downloadFixture.saved)).toEqual(["photo-3.jpg", "photo-1.jpg", "photo-2.jpg"]);
 await page.evaluate(() => { window.downloadFixture.mode = "failure"; });
 await page.getByRole("button", { name: "download all", exact: true }).click();
 await expect(page.getByText("Download failed. Please try again.", { exact: true })).toBeVisible();
 await page.getByRole("button", { name: "Dismiss notification" }).click();
 await page.evaluate(() => { window.downloadFixture.mode = "success"; });
 await page.getByRole("button", { name: "download all", exact: true }).click();
 await expect(page.getByRole("status")).toHaveText("saved 4 files.");
});

for (const action of ["cancel", "unmount"] as const) {
 test(`${action} aborts an active stream without saving or leaking UI work`, async ({ page }) => {
  await page.goto("/?fixture=delivery-downloads");
  await page.evaluate(() => { window.downloadFixture.mode = "stream"; });
  await page.getByLabel("choose location", { exact: true }).check();
  await page.getByRole("button", { name: "download all", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.downloadFixture.fetched.length)).toBe(1);
  await page.getByRole("button", { name: action === "cancel" ? "cancel download" : "Unmount gallery", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.downloadFixture.aborted)).toBe(1);
  expect(await page.evaluate(() => window.downloadFixture.streamCanceled)).toBe(1);
  expect(await page.evaluate(() => window.downloadFixture.saved)).toEqual([]);
  if (action === "cancel") await expect(page.getByRole("status")).toHaveText("download canceled.");
  else {
   await expect(page.getByRole("status")).toHaveCount(0);
   await page.getByRole("button", { name: "Mount gallery", exact: true }).click();
   await expect(page.getByRole("button", { name: "download all", exact: true })).toBeEnabled();
   await expect(page.getByRole("status")).toHaveCount(0);
  }
 });
}

test("a picker resolving after unmount starts no fetch or save", async ({ page }) => {
 await page.goto("/?fixture=delivery-downloads");
 await page.evaluate(() => { window.downloadFixture.mode = "picker"; });
 await page.getByLabel("choose location", { exact: true }).check();
 await page.getByRole("button", { name: "download all", exact: true }).click();
 await expect.poll(() => page.evaluate(() => typeof window.downloadFixture.releasePicker)).toBe("function");
 await page.getByRole("button", { name: "Unmount gallery", exact: true }).click();
 await page.evaluate(async () => { window.downloadFixture.releasePicker?.(); await new Promise(resolve => setTimeout(resolve, 20)); });
 expect(await page.evaluate(() => window.downloadFixture.fetched)).toEqual([]);
 expect(await page.evaluate(() => window.downloadFixture.saved)).toEqual([]);
 await expect(page.getByRole("status")).toHaveCount(0);
});

test("small ZIP posts the existing capability fields and removes its form on unmount", async ({ page }) => {
 await page.goto("/?fixture=delivery-downloads");
 await page.getByRole("button", { name: "download favorites (2)", exact: true }).click();
 expect(await page.evaluate(() => window.downloadFixture.forms)).toEqual([{
  token: "fixture-token", accessGrant: "fixture-grant", galleryName: "Fixture delivery gallery-favorites", imageKeys: '["fixture-0.jpg","fixture-1.jpg"]',
 }]);
 await expect(page.locator('form[action$="/download/zip"]')).toHaveCount(1);
 await page.getByRole("button", { name: "Unmount gallery", exact: true }).click();
 await expect(page.locator('form[action$="/download/zip"]')).toHaveCount(0);
});

test("unmount cancels a prepared ZIP with the original capability and stops polling", async ({ page }) => {
 const requests: Array<{ method: string; path: string; query: string; body: unknown }> = [];
 await page.route("**/download/zip/prepare**", async route => {
  const request = route.request();
  const url = new URL(request.url());
  requests.push({ method: request.method(), path: url.pathname, query: url.search, body: request.postDataJSON() });
  await route.fulfill({ contentType: "application/json", body: JSON.stringify({ status: url.pathname.endsWith("/cancel") ? "canceled" : "queued", requestId: "fixture-request", imageCount: 4, totalBytes: 4 * 1024 ** 3, archiveBytes: 0, processedBytes: 0 }) });
 });
 await page.goto("/?fixture=delivery-downloads&large");
 await page.getByRole("button", { name: "download all", exact: true }).click();
 await expect(page.getByRole("status")).toHaveText("queued ZIP build...");
 await page.getByRole("button", { name: "Unmount gallery", exact: true }).click();
 await expect.poll(() => requests.length).toBe(2);
 expect(requests[0].body).toMatchObject({ token: "fixture-token", accessGrant: "fixture-grant", imageKeys: ["fixture-0.jpg", "fixture-1.jpg", "fixture-2.jpg", "fixture-3.jpg"] });
 expect(requests[1]).toMatchObject({ method: "POST", path: "/download/zip/prepare/fixture-request/cancel", query: "?token=fixture-token&accessGrant=fixture-grant" });
 await page.clock.install();
 await page.clock.fastForward(6000);
 expect(requests).toHaveLength(2);
 await expect(page.getByRole("status")).toHaveCount(0);
});
