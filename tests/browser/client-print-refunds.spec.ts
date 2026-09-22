import { expect, test } from "@playwright/test";
test("mixed refund previews the print-only fee and submits the confirmed allocation", async ({ page }) => {
	const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
	await page.route("**/portal/refunds/**", async route => {
		const form = new URLSearchParams(route.request().postData() ?? "");
		expect(route.request().method()).toBe("POST");
		expect(Object.fromEntries(form)).toMatchObject({ intent: "request", orderId: "fixture_order", line_0: "40", line_1: "10", other: "5", confirmed: "yes" });
		await route.fulfill({ status: 200, contentType: "text/html", body: "<h1>Refund recorded locally</h1>" });
	});
	await page.goto("/?fixture=client-print-refunds");
	await expect(page.getByRole("button", { name: "Refund $0.00", exact: true })).toBeDisabled();
	await page.getByLabel("Refund dollars for Woodland print").fill("40");
	await page.getByLabel("Refund dollars for Digital download").fill("10");
	await page.locator("#other").fill("5");
	await expect(page.locator("dl")).toContainText("$55.00");
	await expect(page.locator("dl")).toContainText("$2.00");
	await expect(page.getByText("A payment refund does not cancel", { exact: false })).toBeVisible();
	await page.getByRole("checkbox").check();
	await page.screenshot({ path: `/tmp/angelsrest-guided-refunds-${test.info().project.name}.png`, fullPage: true });
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
	await page.getByRole("button", { name: "Refund $55.00", exact: true }).click();
	await expect(page.getByRole("heading", { name: "Refund recorded locally" })).toBeVisible();
	expect(errors).toEqual([]);
});
test("pending operation offers a status check rather than another refund", async ({ page }) => {
	await page.route("**/portal/refunds/**", async route => { expect(new URLSearchParams(route.request().postData() ?? "").get("intent")).toBe("retry"); await route.fulfill({ status: 200, contentType: "text/html", body: "<h1>Status checked locally</h1>" }); });
	await page.goto("/?fixture=client-print-refunds&phase=pending");
	await expect(page.getByRole("heading", { name: "Waiting for Stripe" })).toBeVisible();
	await expect(page.getByRole("spinbutton")).toHaveCount(0);
	await page.getByRole("button", { name: "Check and continue refund" }).click();
	await expect(page.getByRole("heading", { name: "Status checked locally" })).toBeVisible();
});
for (const phase of ["disabled", "complete", "attention", "error"]) test(`${phase} state is readable`, async ({ page }) => {
	await page.goto(`/?fixture=client-print-refunds&phase=${phase}`);
	await expect(page.getByRole("heading", { name: "Print refunds", exact: true })).toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
	if (phase === "disabled") await expect(page.getByRole("button")).toHaveCount(0);
	if (phase === "complete") await expect(page.getByRole("heading", { name: "Complete", exact: true })).toBeVisible();
	if (phase === "attention") await expect(page.getByRole("spinbutton")).toHaveCount(0);
	if (phase === "error") await expect(page.getByRole("alert")).toBeVisible();
});
