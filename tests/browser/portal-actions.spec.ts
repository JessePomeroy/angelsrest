import { expect, test, type Page, type Route } from "@playwright/test";

async function holdRequest(page: Page, pattern: string) {
	let receive!: (route: Route) => void;
	const request = new Promise<Route>((resolve) => { receive = resolve; });
	await page.route(pattern, (route) => receive(route));
	return { request };
}

async function settleResponse(page: Page, route: Route, status: number, body: object = {}) {
	const response = page.waitForResponse((response) => response.request() === route.request());
	await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
	await (await response).finished();
	// Let the response continuation and Svelte's DOM update finish before checking
	// that an obsolete response produced no visible state or redirect.
	await page.evaluate(() => new Promise<void>((resolve) => {
		requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
	}));
}

async function openPortal(page: Page, kind: string) {
	await page.goto(`/?fixture=portal-css&kind=${kind}&reuse=1`);
	await expect(page.getByText("Fixture client A", { exact: true })).toBeVisible();
}

for (const status of [200, 503]) {
	test(`a late quote response (${status}) cannot change the next document or its pending action`, async ({ page }) => {
		await openPortal(page, "quote");
		const old = await holdRequest(page, "**/api/portal/fixture-portal-A/accept");
		await page.getByRole("button", { name: "Accept Quote", exact: true }).click();
		const oldRequest = await old.request;
		await page.getByRole("button", { name: "Show document B" }).click();
		await expect(page.getByRole("button", { name: "Decline Quote", exact: true })).toBeEnabled();
		const current = await holdRequest(page, "**/api/portal/fixture-portal-B/decline");
		await page.getByRole("button", { name: "Decline Quote", exact: true }).click();
		const currentRequest = await current.request;
		await settleResponse(page, oldRequest, status);
		await expect(page.locator(".status-badge")).toHaveText("sent");
		await expect(page.locator(".action-banner")).toHaveCount(0);
		await expect(page.locator(".doc-actions button").first()).toBeDisabled();
		await settleResponse(page, currentRequest, 200);
		await expect(page.locator(".status-badge")).toHaveText("declined");
		await expect(page.locator(".action-banner")).toHaveText("quote declined.");
	});
}

test("returning to a token does not revive its previous request, and failure allows a retry", async ({ page }) => {
	await openPortal(page, "quote");
	const old = await holdRequest(page, "**/api/portal/fixture-portal-A/accept");
	await page.getByRole("button", { name: "Accept Quote", exact: true }).click();
	const oldRequest = await old.request;
	await page.getByRole("button", { name: "Show document B" }).click();
	await expect(page.getByText("Fixture client B", { exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Show document A" }).click();
	const current = await holdRequest(page, "**/api/portal/fixture-portal-A/decline");
	await page.getByRole("button", { name: "Decline Quote", exact: true }).click();
	const currentRequest = await current.request;
	await settleResponse(page, oldRequest, 200);
	await expect(page.locator(".status-badge")).toHaveText("sent");
	await expect(page.locator(".action-banner")).toHaveCount(0);
	await expect(page.locator(".doc-actions button").first()).toBeDisabled();
	await settleResponse(page, currentRequest, 503);
	await expect(page.locator(".action-banner")).toContainText("please try again");
	await expect(page.getByRole("button", { name: "Accept Quote", exact: true })).toBeEnabled();
	const retry = await holdRequest(page, "**/api/portal/fixture-portal-A/accept");
	await page.getByRole("button", { name: "Accept Quote", exact: true }).click();
	await expect(page.locator(".action-banner")).toHaveCount(0);
	await settleResponse(page, await retry.request, 200);
	await expect(page.locator(".status-badge")).toHaveText("accepted");
	await page.getByRole("button", { name: "Show document B" }).click();
	await expect(page.locator(".action-banner")).toHaveCount(0);
	await expect(page.locator(".status-badge")).toHaveText("sent");
});

test("same-token refresh preserves the pending lock and authoritative data replaces optimistic status", async ({ page }) => {
	await openPortal(page, "quote");
	const held = await holdRequest(page, "**/api/portal/fixture-portal-A/accept");
	await page.getByRole("button", { name: "Accept Quote", exact: true }).click();
	const request = await held.request;
	await page.getByRole("button", { name: "Refresh document" }).click();
	await expect(page.locator(".doc-actions button").first()).toBeDisabled();
	await settleResponse(page, request, 200);
	// The response belongs to this token, but its optimistic snapshot predates
	// the refreshed authoritative document and must not override it.
	await expect(page.locator(".action-banner")).toContainText("quote accepted");
	await expect(page.locator(".status-badge")).toHaveText("sent");
	await expect(page.getByRole("button", { name: "Accept Quote", exact: true })).toBeEnabled();
	const next = await holdRequest(page, "**/api/portal/fixture-portal-A/decline");
	await page.getByRole("button", { name: "Decline Quote", exact: true }).click();
	await settleResponse(page, await next.request, 200);
	await expect(page.locator(".status-badge")).toHaveText("declined");
	await page.getByRole("button", { name: "Refresh document" }).click();
	await expect(page.locator(".status-badge")).toHaveText("sent");
});

test("contract navigation clears the signer and ignores a previous signature", async ({ page }) => {
	await openPortal(page, "contract");
	const old = await holdRequest(page, "**/api/portal/fixture-portal-A/sign");
	await page.getByLabel("Your full name", { exact: true }).fill("  Synthetic signer A  ");
	await page.getByRole("button", { name: "Sign Contract", exact: true }).click();
	const oldRequest = await old.request;
	expect(oldRequest.request().postDataJSON()).toEqual({ signerName: "Synthetic signer A" });
	await page.getByRole("button", { name: "Show document B" }).click();
	await expect(page.getByLabel("Your full name", { exact: true })).toHaveValue("");
	await settleResponse(page, oldRequest, 200);
	await expect(page.locator(".status-badge")).toHaveText("sent");
	await expect(page.locator(".action-banner")).toHaveCount(0);
	const current = await holdRequest(page, "**/api/portal/fixture-portal-B/sign");
	await page.getByLabel("Your full name", { exact: true }).fill("Synthetic signer B");
	await page.getByRole("button", { name: "Sign Contract", exact: true }).click();
	await settleResponse(page, await current.request, 200);
	await expect(page.locator(".status-badge")).toHaveText("signed");
	await expect(page.locator(".status-message")).toContainText(/This contract was signed\s*on/);
	await page.getByRole("button", { name: "Refresh document" }).click();
	await expect(page.locator(".status-badge")).toHaveText("sent");
});

for (const destination of ["Show document B", "Leave portal"]) {
	test(`a checkout response cannot redirect after ${destination.toLowerCase()}`, async ({ page }) => {
		await openPortal(page, "invoice");
		const held = await holdRequest(page, "**/api/invoice/checkout");
		await page.getByRole("button", { name: "Pay Now", exact: true }).click();
		const request = await held.request;
		expect(request.request().postDataJSON()).toEqual({ token: "fixture-portal-A" });
		await page.getByRole("button", { name: destination }).click();
		const currentUrl = page.url();
		await settleResponse(page, request, 200, { url: `${currentUrl}#checkout-A` });
		expect(page.url()).toBe(currentUrl);
		await expect(page.locator(".action-banner")).toHaveCount(0);
		if (destination === "Show document B") {
			await expect(page.getByRole("button", { name: "Pay Now", exact: true })).toBeEnabled();
		}
	});
}

test("the current invoice can retry a failed checkout and follow its own destination", async ({ page }) => {
	await openPortal(page, "invoice");
	const failed = await holdRequest(page, "**/api/invoice/checkout");
	await page.getByRole("button", { name: "Pay Now", exact: true }).click();
	await settleResponse(page, await failed.request, 503, { message: "Please retry payment shortly" });
	await expect(page.locator(".action-banner")).toHaveText("Please retry payment shortly");
	const retry = await holdRequest(page, "**/api/invoice/checkout");
	await page.getByRole("button", { name: "Pay Now", exact: true }).click();
	const request = await retry.request;
	await page.getByRole("button", { name: "Refresh document" }).click();
	await expect(page.locator(".doc-actions button")).toBeDisabled();
	const destination = `${page.url()}#checkout-A`;
	await settleResponse(page, request, 200, { url: destination });
	await expect(page).toHaveURL(destination);
});

test("a stale network failure cannot add an error to the next document", async ({ page }) => {
	await openPortal(page, "quote");
	const held = await holdRequest(page, "**/api/portal/fixture-portal-A/accept");
	await page.getByRole("button", { name: "Accept Quote", exact: true }).click();
	const request = await held.request;
	await page.getByRole("button", { name: "Show document B" }).click();
	const failed = page.waitForEvent("requestfailed", (failed) => failed === request.request());
	await request.abort("failed");
	await failed;
	await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
	await expect(page.locator(".action-banner")).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Accept Quote", exact: true })).toBeEnabled();
});
