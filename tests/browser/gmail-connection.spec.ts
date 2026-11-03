import { expect, test } from "@playwright/test";

const reference = "12345678-1234-4321-9876-123456789abc";
test.beforeEach(async ({ page }) => {
	await page.route("**/*", (route) =>
		new URL(route.request().url()).origin === "http://127.0.0.1:5196"
			? route.fallback()
			: route.abort(),
	);
});

test("Google cancellation and account mismatch have different recovery and never attempt completion", async ({
	page,
}) => {
	let completions = 0;
	await page.route("**/api/admin/gmail/complete-linked", (route) => {
		completions++;
		return route.abort();
	});
	for (const [error, text] of [
		["access_denied", "permission was canceled or declined"],
		["email_doesn't_match", "does not match this connection"],
		["synthetic-private-provider-error", "server could not finish"],
	]) {
		await page.goto(
			`/?fixture=gmail-connection&google_link=error&error=${encodeURIComponent(error)}`,
		);
		await expect(page.getByRole("status")).toContainText(text);
		await expect(page.getByRole("link", { name: "return to inquiries" })).toBeVisible();
		await expect(page.locator("body")).not.toContainText("synthetic-private-provider-error");
	}
	expect(completions).toBe(0);
});

test("server failure displays a safe support reference without exposing SDK details", async ({
	page,
}, info) => {
	await page.route("**/api/admin/gmail/complete-linked", (route) =>
		route.fulfill({
			status: 503,
			json: {
				connected: false,
				code: "server_failure",
				reference,
				returnTo: "/admin/crm",
				error: "synthetic-access-secret synthetic-refresh-secret <script>unsafe</script>",
			},
		}),
	);
	await page.goto("/?fixture=gmail-connection");
	await expect(page.getByRole("status")).toContainText("server could not finish");
	await expect(page.getByRole("status")).toContainText("repeating Google consent may not resolve");
	await expect(page.getByText(`Support reference: ${reference}`)).toBeVisible();
	await expect(page.getByRole("link", { name: "return to clients" })).toHaveAttribute(
		"href",
		"/admin/crm",
	);
	await expect(page.locator("body")).not.toContainText("synthetic-access-secret");
	const width = await page.evaluate(() => ({
		document: document.documentElement.scrollWidth,
		viewport: innerWidth,
	}));
	expect(width.document).toBeLessThanOrEqual(width.viewport);
	const screenshot = info.outputPath("connection-server-failure.png");
	await page.screenshot({ path: screenshot });
	await info.attach("connection-server-failure", { path: screenshot, contentType: "image/png" });
});

test("missing grant and expired intent direct the user to the right next action", async ({
	page,
}) => {
	for (const [code, text] of [
		["missing_permissions", "read, send and offline access"],
		["intent_expired", "Start a fresh request"],
	]) {
		await page.route("**/api/admin/gmail/complete-linked", (route) =>
			route.fulfill({ status: 400, json: { connected: false, code, reference } }),
		);
		await page.goto("/?fixture=gmail-connection");
		await expect(page.getByRole("status")).toContainText(text);
		await page.unroute("**/api/admin/gmail/complete-linked");
	}
});

test("callback query values cannot inject content, redirect away or start another consent attempt", async ({
	page,
}) => {
	let completions = 0;
	await page.route("**/api/admin/gmail/complete-linked", (route) => {
		completions++;
		return route.abort();
	});
	const query = new URLSearchParams({
		fixture: "gmail-connection",
		gmail_error: "<script>synthetic-secret</script>",
		gmail_ref: "synthetic-secret",
		returnTo: "//untrusted.example",
	});
	await page.goto(`/?${query}`);
	await expect(page.getByRole("status")).toContainText("server could not finish");
	await expect(page.locator("body")).not.toContainText("synthetic-secret");
	await expect(page.getByRole("link", { name: "return to inquiries" })).toHaveAttribute(
		"href",
		"/admin/inquiries",
	);
	expect(completions).toBe(0);
});

test("successful completion navigates to the authorized record area once", async ({ page }) => {
	let completions = 0;
	await page.route("**/api/admin/gmail/complete-linked", (route) => {
		completions++;
		return route.fulfill({ json: { connected: true, returnTo: "/admin/crm?gmail=connected" } });
	});
	await page.route("**/admin/crm?gmail=connected", (route) =>
		route.fulfill({
			contentType: "text/html",
			body: "<main>Connected synthetic destination</main>",
		}),
	);
	await page.goto("/?fixture=gmail-connection");
	await expect(page).toHaveURL(/\/admin\/crm\?gmail=connected$/);
	expect(completions).toBe(1);
});

test("a malformed success response is a server failure, not missing permission", async ({
	page,
}) => {
	await page.route("**/api/admin/gmail/complete-linked", (route) =>
		route.fulfill({ json: { returnTo: "/admin/inquiries", connected: "synthetic-invalid" } }),
	);
	await page.goto("/?fixture=gmail-connection");
	await expect(page.getByRole("status")).toContainText("server could not finish");
	await expect(page.getByRole("status")).not.toContainText("approve those permissions");
});
