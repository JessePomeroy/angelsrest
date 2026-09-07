import { expect, test } from "@playwright/test";

const scriptUrl = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const providerScript = `
(() => {
 const records = [];
 const resets = [];
 const removals = [];
 window.turnstileFixture = {
  records, resets, removals,
  late(index) {
   const options = records[index].options;
   options.callback("late");
   options["error-callback"]("late");
   options["expired-callback"]();
  }
 };
 window.turnstile = {
  render(container, options) {
   if (!(container instanceof HTMLElement)) throw new Error("Expected instance DOM element");
   const id = "widget-" + records.length;
   const input = document.createElement("input");
   input.type = "hidden";
   input.name = "cf-turnstile-response";
   container.append(input);
   records.push({ id, container, input, options });
   for (const kind of ["verify", "error", "expire"]) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Provider " + kind;
    button.onclick = () => {
     if (kind === "verify") { input.value = id; options.callback(id); }
     if (kind === "error") { input.value = ""; options["error-callback"]("provider-error"); }
     if (kind === "expire") { input.value = ""; options["expired-callback"](); }
    };
    container.append(button);
   }
   return id;
  },
  reset(id) { resets.push(id); records.find(record => record.id === id).input.value = ""; },
  remove(id) { removals.push(id); records.find(record => record.id === id).container.replaceChildren(); }
 };
})();`;

declare global {
	interface Window {
		turnstileFixture: {
			records: Array<{ id: string; options: { theme: string; action: string } }>;
			resets: string[];
			removals: string[];
			late: (index: number) => void;
		};
	}
}

test.beforeEach(async ({ page }) => {
	await page.route("**/*", async (route) => {
		const url = route.request().url();
		if (new URL(url).origin === "http://127.0.0.1:5196") return route.continue();
		if (url === scriptUrl) return route.fulfill({ contentType: "text/javascript", body: providerScript });
		await route.abort();
		throw new Error(`Unexpected external request: ${url}`);
	});
});

test("two widgets isolate tokens, callback state, resets, and unmount cleanup", async ({ page }) => {
	const errors: string[] = [];
	page.on("pageerror", error => errors.push(error.message));
	await page.goto("/?fixture=turnstile");
	const first = page.getByRole("region", { name: "first", exact: true });
	const second = page.getByRole("region", { name: "second", exact: true });
	await first.getByRole("button", { name: "Provider verify" }).click();
	await expect(first.getByLabel("first status")).toHaveText("verified:widget-0");
	await expect(second.getByLabel("second status")).toHaveText("idle");
	await first.getByRole("button", { name: "Submit first" }).click();
	await expect(first.getByLabel("first submitted token")).toHaveText("widget-0");
	await second.getByRole("button", { name: "Provider verify" }).click();
	await second.getByRole("button", { name: "Submit second" }).click();
	await expect(second.getByLabel("second submitted token")).toHaveText("widget-1");
	await first.getByRole("button", { name: "Provider error" }).click();
	await expect(first.getByLabel("first status")).toHaveText("error:provider-error");
	await expect(second.getByLabel("second status")).toHaveText("verified:widget-1");
	await first.getByRole("button", { name: "Provider expire" }).click();
	await expect(first.getByLabel("first status")).toHaveText("expired");
	await second.getByRole("button", { name: "Reset second" }).click();
	await second.getByRole("button", { name: "Submit second" }).click();
	await expect(second.getByLabel("second submitted token")).toHaveText("");
	expect(await page.evaluate(() => window.turnstileFixture.resets)).toEqual(["widget-0", "widget-1"]);
	expect(await page.evaluate(() => window.turnstileFixture.records.map(({ options }) => [options.theme, options.action]))).toEqual([["auto", "turnstile-spin-v1"], ["dark", "turnstile-spin-v1"]]);
	await first.getByRole("button", { name: "Unmount first", exact: true }).click();
	await page.evaluate(() => window.turnstileFixture.late(0));
	await expect(first.getByLabel("first status")).toHaveText("expired");
	expect(await page.evaluate(() => window.turnstileFixture.removals)).toEqual(["widget-0"]);
	await first.getByRole("button", { name: "Mount first", exact: true }).click();
	await first.getByRole("button", { name: "Provider verify" }).click();
	await expect(first.getByLabel("first status")).toHaveText("verified:widget-2");
	await first.getByRole("button", { name: "Unmount first", exact: true }).click();
	await second.getByRole("button", { name: "Unmount second", exact: true }).click();
	expect(await page.evaluate(() => window.turnstileFixture.removals)).toEqual(["widget-0", "widget-2", "widget-1"]);
	expect(errors).toEqual([]);
});

test("a delayed shared script does not render an unmounted widget", async ({ page }) => {
	let release!: () => void;
	const gate = new Promise<void>(resolve => { release = resolve; });
	await page.route(scriptUrl, async route => {
		await gate;
		await route.fulfill({ contentType: "text/javascript", body: providerScript });
	});
	try {
		await page.goto("/?fixture=turnstile", { waitUntil: "domcontentloaded" });
		await page.getByRole("button", { name: "Unmount first", exact: true }).click();
	} finally { release(); }
	const second = page.getByRole("region", { name: "second", exact: true });
	await second.getByRole("button", { name: "Provider verify" }).click();
	await expect(page.getByLabel("first status", { exact: true })).toHaveText("idle");
	expect(await page.evaluate(() => window.turnstileFixture.records.length)).toBe(1);
	await page.getByRole("button", { name: "Mount first", exact: true }).click();
	await page.getByRole("region", { name: "first", exact: true }).getByRole("button", { name: "Provider verify" }).click();
	await expect(page.getByLabel("first status", { exact: true })).toHaveText("verified:widget-1");
});

test("script failure reports load errors and a remount retries successfully", async ({ page }) => {
	await page.route(scriptUrl, route => route.abort());
	await page.goto("/?fixture=turnstile");
	await expect(page.getByLabel("first status", { exact: true })).toHaveText("load-error");
	await expect(page.getByLabel("second status", { exact: true })).toHaveText("load-error");
	await page.getByRole("button", { name: "Unmount first", exact: true }).click();
	await page.unroute(scriptUrl);
	await page.getByRole("button", { name: "Mount first", exact: true }).click();
	await page.getByRole("region", { name: "first", exact: true }).getByRole("button", { name: "Provider verify" }).click();
	await expect(page.getByLabel("first status", { exact: true })).toHaveText("verified:widget-0");
});

test("contact submission preserves provider token and resets after the response", async ({ page }) => {
	let submitted: Record<string, unknown> | undefined;
	await page.route("**/api/contact", async route => {
		expect(route.request().method()).toBe("POST");
		submitted = JSON.parse(route.request().postData() ?? "{}");
		await route.fulfill({ contentType: "application/json", body: "{}" });
	});
	await page.goto("/?fixture=contact");
	await page.getByLabel("name", { exact: true }).fill("Fixture Customer");
	await page.getByLabel("email", { exact: true }).fill("fixture@example.invalid");
	await page.getByLabel("message", { exact: true }).fill("Fixture inquiry");
	const submit = page.getByRole("button", { name: "send message", exact: true });
	await expect(submit).toBeDisabled();
	await page.getByRole("button", { name: "Provider verify" }).click();
	await submit.click();
	await expect(page.getByText("message sent !", { exact: true })).toBeVisible();
	expect(submitted).toMatchObject({ name: "Fixture Customer", email: "fixture@example.invalid", message: "Fixture inquiry", "cf-turnstile-response": "widget-0" });
	await expect(submit).toBeDisabled();
	expect(await page.evaluate(() => window.turnstileFixture.resets)).toEqual(["widget-0"]);
	await page.getByRole("button", { name: "Provider expire" }).click();
	await expect(page.getByText("Verification expired. Please complete it again.", { exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Provider error" }).click();
	await expect(page.getByText("Verification could not load. Please try again.", { exact: true })).toBeVisible();
	await expect(submit).toBeDisabled();
});

test("order lookup preserves POST token protocol and resets after rejection", async ({ page }) => {
	let submitted: Record<string, unknown> | undefined;
	await page.route("**/api/orders/lookup", async route => {
		expect(route.request().method()).toBe("POST");
		submitted = JSON.parse(route.request().postData() ?? "{}");
		await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "Order not found" }) });
	});
	await page.goto("/?fixture=orders");
	await page.getByLabel("Email", { exact: true }).fill("fixture@example.invalid");
	await page.getByLabel("Order Number", { exact: true }).fill("ORD-FIXTURE");
	const submit = page.getByRole("button", { name: "Track Order", exact: true });
	await expect(submit).toBeDisabled();
	await page.getByRole("button", { name: "Provider verify" }).click();
	await submit.click();
	await expect(page.getByText("Order not found", { exact: true })).toBeVisible();
	expect(submitted).toEqual({ email: "fixture@example.invalid", orderNumber: "ORD-FIXTURE", "cf-turnstile-response": "widget-0" });
	await expect(submit).toBeDisabled();
	expect(await page.evaluate(() => window.turnstileFixture.resets)).toEqual(["widget-0"]);
});
