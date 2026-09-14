import { expect, test } from "@playwright/test";
import { contentSecurityPolicy } from "../../src/lib/config/securityPolicy";

const scriptUrl = "https://app.cal.com/embed/embed.js";
// Preserve the provider's command queue protocol without opening a live booking.
const providerScript = `
window.bookingCommands = [];
const api = window.Cal.ns.photosession;
api.instance = {};
window.bookingCommands.push(...api.q);
api.q.push = (...commands) => window.bookingCommands.push(...commands);
`;

declare global {
 interface Window { bookingCommands: unknown[][]; }
}

test.beforeEach(async ({ page }) => {
 await page.route("**/*", async route => {
  const url = route.request().url();
  if (new URL(url).origin === "http://127.0.0.1:5196") return route.continue();
  if (url === scriptUrl) return route.fulfill({ contentType: "text/javascript", body: providerScript });
  await route.abort();
  throw new Error(`Unexpected external request: ${url}`);
 });
});

test("disabled booking loads nothing; enabled booking opens and closes through its provider", async ({ page }) => {
 const requests: string[] = [];
 page.on("request", request => { if (request.url() === scriptUrl) requests.push(request.url()); });
 await page.goto("/?fixture=booking");
 await expect(page.getByRole("button", { name: "Enable booking" })).toBeVisible();
 expect(requests).toEqual([]);
 await page.getByRole("button", { name: "Enable booking" }).click();
 await page.getByRole("button", { name: "Book a session" }).click();
 expect(await page.evaluate(() => window.bookingCommands)).toContainEqual(["modal", { calLink: "fixture/photos" }]);
 await page.getByRole("button", { name: "Disable booking" }).click();
 expect(await page.evaluate(() => window.bookingCommands.at(-1))).toEqual(["closeModal"]);
 await page.getByRole("button", { name: "Enable booking" }).click();
 await expect(page.getByRole("button", { name: "Book a session" })).toBeEnabled();
 expect(requests).toHaveLength(1);
});

test("unmount during loading ignores late initialization and reentry reuses the script", async ({ page }) => {
 let release!: () => void;
 const gate = new Promise<void>(resolve => { release = resolve; });
 await page.route(scriptUrl, async route => {
  await gate;
  await route.fulfill({ contentType: "text/javascript", body: providerScript });
 });
 await page.goto("/?fixture=booking");
 try {
  await page.getByRole("button", { name: "Enable booking" }).click();
  await expect(page.getByRole("button", { name: "Book a session" })).toBeDisabled();
  await page.getByRole("button", { name: "Disable booking" }).click();
 } finally { release(); }
 await expect.poll(() => page.evaluate(() => window.bookingCommands?.length)).toBe(1);
 expect(await page.evaluate(() => window.bookingCommands.map(command => command[0]))).toEqual(["init"]);
 await page.getByRole("button", { name: "Enable booking" }).click();
 await expect(page.getByRole("button", { name: "Book a session" })).toBeEnabled();
 expect(await page.evaluate(() => window.bookingCommands.map(command => command[0]))).toEqual(["init", "ui"]);
});

for (const failure of ["network", "initialization"] as const) {
 test(`${failure} failure offers a direct link and remount retries`, async ({ page }) => {
  await page.route(scriptUrl, route => failure === "network" ? route.abort() : route.fulfill({ contentType: "text/javascript", body: "/* did not initialize */" }));
  await page.goto("/?fixture=booking");
  await page.getByRole("button", { name: "Enable booking" }).click();
  await expect(page.getByRole("status")).toContainText("booking could not load");
  await expect(page.getByRole("link", { name: "open booking page" })).toHaveAttribute("href", "https://cal.com/fixture/photos");
  await expect(page.getByRole("button", { name: "Book a session" })).toBeDisabled();
  await page.getByRole("button", { name: "Disable booking" }).click();
  await page.unroute(scriptUrl);
  await page.getByRole("button", { name: "Enable booking" }).click();
  await expect(page.getByRole("button", { name: "Book a session" })).toBeEnabled();
  await expect(page.getByRole("status")).toHaveCount(0);
 });
}


test("production CSP permits the booking script and modal frame", async ({ page }) => {
 const frameUrl = "https://app.cal.com/fixture/photos/embed";
 await page.route("http://127.0.0.1:5196/?fixture=booking", async route => {
  const response = await route.fetch();
  await route.fulfill({ response, headers: { ...response.headers(), "content-security-policy": contentSecurityPolicy } });
 });
 await page.route(scriptUrl, route => route.fulfill({ contentType: "text/javascript", body: `${providerScript}
  api.q.push = (...commands) => {
   window.bookingCommands.push(...commands);
   if (commands.some(command => command[0] === "modal")) {
    const frame = document.createElement("iframe");
    frame.title = "Booking calendar";
    frame.src = ${JSON.stringify(frameUrl)};
    document.body.append(frame);
   }
  };
 ` }));
 await page.route(frameUrl, route => route.fulfill({ contentType: "text/html", body: "<h1>Booking calendar fixture</h1>" }));
 await page.goto("/?fixture=booking");
 await page.getByRole("button", { name: "Enable booking" }).click();
 await expect(page.getByRole("button", { name: "Book a session" })).toBeEnabled();
 await page.getByRole("button", { name: "Book a session" }).click();
 await expect(page.frameLocator('iframe[title="Booking calendar"]').getByRole("heading", { name: "Booking calendar fixture" })).toBeVisible();
});
