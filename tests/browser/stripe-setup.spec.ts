import { expect, test } from "@playwright/test";

test("client sign-in shows recoverable errors without provider requests", async ({ page }) => {
	await page.goto("/?fixture=stripe-setup&phase=signed_out");
	await page.getByLabel("email", { exact: true }).fill("studio@example.invalid");
	await page.getByLabel("password", { exact: true }).fill("fictional-password");
	await page.getByRole("button", { name: "sign in", exact: true }).click();
	await expect(page.getByRole("alert")).toContainText("Simulated authentication failure");
	await expect(page.getByLabel("email", { exact: true })).toHaveValue("studio@example.invalid");
});

test("setup posts to the stable tenant action", async ({ page }) => {
	await page.route("**/portal/stripe/**", async route => {
		expect(route.request().method()).toBe("POST");
		expect(new URL(route.request().url()).pathname).toBe("/portal/stripe/studio.example.invalid");
		expect(new URL(route.request().url()).search).toBe("?/start");
		await route.fulfill({ status: 200, contentType: "text/html", body: "<h1>Local Stripe redirect fixture</h1>" });
	});
	await page.goto("/?fixture=stripe-setup");
	await page.getByRole("button", { name: "Start Stripe setup" }).click();
	await expect(page.getByRole("heading", { name: "Local Stripe redirect fixture" })).toBeVisible();
});

test("a returned pending account distinguishes payments from payouts", async ({ page }) => {
	await page.goto("/?fixture=stripe-setup&phase=pending_verification&returned=1");
	await expect(page.getByRole("heading", { name: "Stripe is reviewing your information" })).toBeVisible();
	await expect(page.getByText("Returning from Stripe does not mean setup is complete.", { exact: false })).toBeVisible();
	await expect(page.locator(".capabilities div").filter({ hasText: "Receive payouts" })).toContainText("Not enabled");
	await expect(page.getByRole("button", { name: "Continue with Stripe" })).toBeVisible();
	await expect(page.getByRole("link", { name: "Set up LumaPrints" })).toHaveCount(0);
	await page.getByRole("button", { name: "Sign out", exact: true }).click();
	await expect(page.getByRole("alert")).toContainText("We could not sign you out");
	await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeEnabled();
});

test("ready accounts use their full dashboard and keep store activation separate", async ({ page }) => {
	await page.goto("/?fixture=stripe-setup&phase=ready&returned=1");
	await expect(page.getByRole("heading", { name: "Your Stripe account is ready" })).toBeVisible();
	await expect(page.getByRole("link", { name: "Open Stripe dashboard" })).toHaveAttribute("href", "https://dashboard.stripe.com/");
	await expect(page.getByRole("button", { name: /Stripe/ })).toHaveCount(0);
	await expect(page.getByText("Store activation is a separate step.")).toBeVisible();
	await expect(page.getByRole("link", { name: "Set up LumaPrints" })).toHaveAttribute("href", "https://dashboard.lumaprints.com/account/register/");
});

for (const phase of ["disabled", "unauthorized", "unavailable", "restricted", "setup_required", "expired", "checking", "disconnected", "connection_unavailable"]) {
	test(`${phase} state stays readable at the current viewport`, async ({ page }) => {
		const errors: string[] = [];
		page.on("pageerror", error => errors.push(error.message));
		await page.goto(`/?fixture=stripe-setup&phase=${phase}`);
		await expect(page.getByRole("heading", { level: 1 })).toHaveText("Set up your Stripe account");
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
		if (["disabled", "unauthorized", "unavailable", "checking", "disconnected", "connection_unavailable"].includes(phase)) await expect(page.getByRole("button", { name: /Stripe/ })).toHaveCount(0);
		if (phase === "expired") await expect(page.getByRole("alert")).toContainText("Your session expired");
		expect(errors).toEqual([]);
	});
}


test("disconnected accounts keep dashboard access without a reconnect action", async ({ page }) => {
	await page.goto("/?fixture=stripe-setup&phase=disconnected");
	await expect(page.getByRole("heading", { name: "Your Stripe connection has been disconnected" })).toBeVisible();
	await expect(page.getByRole("link", { name: "Open Stripe dashboard" })).toHaveAttribute("href", "https://dashboard.stripe.com/");
	await expect(page.getByRole("button", { name: /Stripe/ })).toHaveCount(0);
	await expect(page.locator(".capabilities")).toHaveCount(0);
});
