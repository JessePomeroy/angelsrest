import { expect, test } from "@playwright/test";

test("a pending save cannot drag the sheet away, and a failed save can be retried", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	const pending = Promise.withResolvers<void>();
	let attempts = 0;
	await page.route("**/api/admin/mutation", async route => {
		expect(route.request().postDataJSON()).toMatchObject({ name: "platform:createClient", args: { siteUrl: "cedarfinch.example", subscriptionStatus: "none", role: "client" } });
		if (++attempts === 1) {
			await pending.promise;
			await route.fulfill({ status: 500, json: { error: "Server Error" } });
		} else await route.fulfill({ json: { result: "fixture-client" } });
	});
	await page.goto("/?fixture=platform-client-create");
	await page.getByRole("button", { name: "Add platform client", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Add platform client" });
	await page.getByLabel("Business name", { exact: true }).fill("Cedar Finch Studio");
	await page.getByLabel("Website hostname").fill("https://www.cedarfinch.example/");
	await page.getByLabel("Client admin email").fill("owner@cedarfinch.example");
	await dialog.getByRole("button", { name: "Add client", exact: true }).click();
	await expect(dialog.getByRole("button", { name: "Adding client…" })).toBeDisabled();
	const handle = await dialog.locator(".sheet-handle").boundingBox();
	if (!handle) throw new Error("Mobile sheet handle missing");
	await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
	await page.mouse.down();
	await page.mouse.move(handle.x + handle.width / 2, handle.y + 300, { steps: 10 });
	await page.mouse.up();
	pending.resolve();
	await expect(dialog.getByRole("alert")).toContainText("Check the platform list before trying again");
	const save = dialog.getByRole("button", { name: "Add client", exact: true });
	await save.scrollIntoViewIfNeeded();
	await expect(save).toBeInViewport();
	await save.click();
	await expect(dialog).toHaveCount(0);
	await expect(page.getByLabel("Selected client")).toHaveText("cedarfinch.example");
	expect(attempts).toBe(2);
});

test("the HTTP application error gives duplicate-website recovery without losing input", async ({ page }) => {
	await page.route("**/api/admin/mutation", route => route.fulfill({ status: 500, json: { error: 'Uncaught ConvexError: A platform client already owns siteUrl="cedarfinch.example"' } }));
	await page.goto("/?fixture=platform-client-create");
	await page.getByRole("button", { name: "Add platform client", exact: true }).click();
	await page.getByLabel("Business name", { exact: true }).fill("Cedar Finch Studio");
	await page.getByLabel("Website hostname").fill("cedarfinch.example");
	await page.getByLabel("Client admin email").fill("owner@cedarfinch.example");
	await page.getByRole("button", { name: "Add client", exact: true }).click();
	await expect(page.getByRole("alert")).toContainText("Select the existing client below");
	await expect(page.getByLabel("Website hostname")).toHaveValue("cedarfinch.example");
	await page.getByRole("button", { name: "Cancel", exact: true }).click();
	await expect(page.getByRole("dialog")).toHaveCount(0);
});
