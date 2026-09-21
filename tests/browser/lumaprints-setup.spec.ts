import { expect, test } from "@playwright/test";

test("requires both confirmations and posts only the configured reference", async ({ page }) => {
	await page.route("**/admin/platform/lumaprints/**", async route => {
		expect(route.request().method()).toBe("POST");
		const url = new URL(route.request().url());
		expect(url.pathname).toBe("/admin/platform/lumaprints/studio.example.invalid");
		expect(url.search).toBe("?/connect");
		const fields = new URLSearchParams(route.request().postData() ?? "");
		expect([...fields.entries()]).toEqual([
			["connectionRef", "lp_fixture_client_original"], ["accountOwnershipConfirmed", "on"], ["billingConfirmed", "on"],
		]);
		await route.fulfill({ status: 200, contentType: "text/html", body: "<h1>Local supplier setup response</h1>" });
	});
	await page.goto("/?fixture=lumaprints-setup");
	const button = page.getByRole("button", { name: "Verify store and save connection" });
	await page.getByLabel("Configured store").selectOption("lp_fixture_client_original");
	await button.click();
	await expect(page.getByRole("heading", { name: "Set up LumaPrints" })).toBeVisible();
	await page.getByLabel("The client owns this LumaPrints account and store.", { exact: true }).check();
	await button.click();
	await expect(page.getByRole("heading", { name: "Set up LumaPrints" })).toBeVisible();
	await page.getByLabel("The client’s payment method", { exact: false }).check();
	await button.click();
	await expect(page.getByRole("heading", { name: "Local supplier setup response" })).toBeVisible();
});

test("changing the selected store clears earlier ownership and billing confirmations", async ({ page }) => {
	await page.goto("/?fixture=lumaprints-setup");
	await page.getByLabel("Configured store").selectOption("lp_fixture_client_original");
	await page.getByRole("checkbox").nth(0).check();
	await page.getByRole("checkbox").nth(1).check();
	await page.getByLabel("Configured store").selectOption("lp_fixture_client_second");
	await expect(page.getByRole("checkbox").nth(0)).not.toBeChecked();
	await expect(page.getByRole("checkbox").nth(1)).not.toBeChecked();
});

for (const phase of ["disabled", "unauthorized", "unavailable", "unconfigured", "connected", "historical", "error"]) {
	test(`${phase} remains readable and keeps shop activation separate`, async ({ page }) => {
		const errors: string[] = [];
		page.on("pageerror", error => errors.push(error.message));
		await page.goto(`/?fixture=lumaprints-setup&phase=${phase}`);
		await expect(page.getByRole("heading", { name: "Set up LumaPrints" })).toBeVisible();
		await expect(page.getByText("Shop activation is a separate step.", { exact: false })).toBeVisible();
		if (phase !== "error") await expect(page.getByRole("button", { name: "Verify store and save connection" })).toHaveCount(0);
		if (phase === "error") await expect(page.getByRole("alert")).toContainText("could not be verified");
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
		expect(errors).toEqual([]);
	});
}
