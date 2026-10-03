import { expect, type Page, test } from "@playwright/test";

const siteUrl = "cedarfinch.example";
const absent = { kind: "absent", siteUrl };
const matching = { kind: "matching", siteUrl, clientId: "client", tenantId: "tenant_05eb6092-5d8c-43ce-ad26-1a59522bd07b" };
const input = { name: "Cedar Finch Studio", siteUrl, email: "owner@cedarfinch.example", tier: "basic" };
async function openForm(page: Page) {
	await page.goto("/?fixture=platform-client-create");
	await page.getByRole("button", { name: "Add platform client", exact: true }).click();
	await page.getByLabel("Business name", { exact: true }).fill(input.name);
	await page.getByLabel("Website hostname").fill(`https://www.${siteUrl}/`);
	await page.getByLabel("Client admin email").fill(input.email);
}
async function review(page: Page) {
	await page.getByRole("button", { name: "Review setup", exact: true }).click();
	await expect(page.getByRole("button", { name: "Create client", exact: true })).toBeEnabled();
}
test.beforeEach(async ({ page }) => {
	await page.route("**/api/admin/platform-clients/status", route => route.fulfill({ json: absent }));
});

test("a pending save cannot drag the sheet away, and only an explicit retry creates after an absent read", async ({ page }, testInfo) => {
	await page.addInitScript(() => {
		Object.defineProperty(navigator, "clipboard", { value: { writeText: async (value: string) => { document.documentElement.dataset.copiedLogin = value; } } });
	});
	await page.setViewportSize({ width: 390, height: 844 });
	const pending = Promise.withResolvers<void>();
	let attempts = 0;
	await page.route("**/api/admin/platform-clients", async route => {
		expect(route.request().postDataJSON()).toEqual(input);
		if (++attempts === 1) {
			await pending.promise;
			await route.fulfill({ status: 500, json: { error: "Server Error" } });
		} else await route.fulfill({ json: { kind: "created", email: input.email, temporaryPassword: "Fixture-Password-Only-42!" } });
	});
	await openForm(page);
	await review(page);
	const dialog = page.getByRole("dialog", { name: "Review client setup" });
	await dialog.getByRole("button", { name: "Create client", exact: true }).dblclick();
	await expect(dialog.getByRole("button", { name: "Adding client…" })).toBeDisabled();
	const handle = await dialog.locator(".sheet-handle").boundingBox();
	if (!handle) throw new Error("Mobile sheet handle missing");
	await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
	await page.mouse.down();
	await page.mouse.move(handle.x + handle.width / 2, handle.y + 300, { steps: 10 });
	await page.mouse.up();
	pending.resolve();
	await expect(dialog.getByRole("status")).toContainText("No matching client is visible yet");
	expect(attempts).toBe(1);
	const retry = dialog.getByRole("button", { name: "Retry creation", exact: true });
	await retry.scrollIntoViewIfNeeded();
	await expect(retry).toBeInViewport();
	await retry.click();
	await expect(page.getByRole("dialog", { name: "Client added", exact: true })).toBeVisible();
	await expect(page.getByLabel("Temporary password", { exact: true })).toHaveAttribute("type", "password");
	await page.getByRole("button", { name: "Reveal password", exact: true }).click();
	await expect(page.getByLabel("Temporary password", { exact: true })).toHaveValue("Fixture-Password-Only-42!");
	await page.getByRole("button", { name: "Copy login details", exact: true }).click();
	await expect(page.getByRole("button", { name: "Copied", exact: true })).toBeVisible();
	expect(await page.evaluate(() => document.documentElement.dataset.copiedLogin)).toContain(`Email: ${input.email}\nTemporary password: Fixture-Password-Only-42!`);
	if (testInfo.project.name === "desktop") await page.setViewportSize({ width: 1440, height: 1000 });
	await page.screenshot({ path: `/tmp/angelsrest-resume25-password-${testInfo.project.name}.png` });
	await page.getByRole("button", { name: "Done", exact: true }).click();
	await expect(page.getByLabel("Temporary password", { exact: true })).toHaveCount(0);
	await expect(page.getByLabel("Selected client")).toHaveText(siteUrl);
	await page.getByRole("button", { name: "Add platform client", exact: true }).click();
	await expect(page.getByLabel("Temporary password", { exact: true })).toHaveCount(0);
	expect(attempts).toBe(2);
});

test("a matching setup resumes without mutation or a credential handoff claim", async ({ page }, testInfo) => {
	let mutations = 0;
	await page.route("**/api/admin/platform-clients/status", route => route.fulfill({ json: matching }));
	await page.route("**/api/admin/platform-clients", route => { mutations++; return route.abort(); });
	await openForm(page);
	await page.getByRole("button", { name: "Review setup", exact: true }).click();
	await expect(page.getByText("Password handoff is unconfirmed.", { exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: "Create client", exact: true })).toHaveCount(0);
	await expect(page.getByLabel("Temporary password", { exact: true })).toHaveCount(0);
	await page.screenshot({ path: `/tmp/angelsrest-resume25-matching-${testInfo.project.name}.png` });
	await page.getByRole("button", { name: "Select existing client", exact: true }).click();
	await expect(page.getByLabel("Selected client")).toHaveText(siteUrl);
	expect(mutations).toBe(0);
});

test("a committed write with a lost response reads status once without replay or replacement password", async ({ page }) => {
	let reads = 0;
	let writes = 0;
	await page.route("**/api/admin/platform-clients/status", route => route.fulfill({ json: ++reads === 1 ? absent : matching }));
	await page.route("**/api/admin/platform-clients", route => { writes++; return route.abort(); });
	await openForm(page);
	await review(page);
	await page.getByRole("button", { name: "Create client", exact: true }).click();
	await expect(page.getByText("Password handoff is unconfirmed.", { exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: "Retry creation", exact: true })).toHaveCount(0);
	await expect(page.getByLabel("Temporary password", { exact: true })).toHaveCount(0);
	expect(reads).toBe(2);
	expect(writes).toBe(1);
});

test("a conflicting setup stops creation and preserves details for review", async ({ page }) => {
	await page.route("**/api/admin/platform-clients/status", route => route.fulfill({ json: { ...matching, kind: "conflict", conflicts: ["email", "adminIdentity"] } }));
	await openForm(page);
	await page.getByRole("button", { name: "Review setup", exact: true }).click();
	await expect(page.getByRole("alert")).toContainText("Further creation is stopped");
	await expect(page.getByText("Resolve these differences", { exact: false })).toContainText("Administrator membership");
	await expect(page.getByRole("button", { name: "Create client", exact: true })).toHaveCount(0);
	await page.getByRole("button", { name: "Edit details", exact: true }).click();
	await expect(page.getByLabel("Client admin email")).toHaveValue(input.email);
});

test("existing accounts keep their login only after a confirmed creation response", async ({ page }) => {
	await page.route("**/api/admin/platform-clients", route => route.fulfill({ json: { kind: "created", email: input.email, temporaryPassword: null } }));
	await openForm(page);
	await review(page);
	await page.getByRole("button", { name: "Create client", exact: true }).click();
	await expect(page.getByText("This email already has a login.", { exact: false })).toBeVisible();
	await expect(page.getByLabel("Temporary password", { exact: true })).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Copy login details" })).toHaveCount(0);
});

test("an unverified existing login explains the rejected creation and keeps form details", async ({ page }) => {
	await page.route("**/api/admin/platform-clients", route => route.fulfill({ status: 409, json: { error: "PLATFORM_CLIENT_LOGIN_UNVERIFIED" } }));
	await openForm(page);
	await review(page);
	await page.getByRole("button", { name: "Create client", exact: true }).click();
	await expect(page.getByRole("alert")).toContainText("Verify the login before adding this client.");
	await expect(page.getByLabel("Client admin email")).toHaveValue(input.email);
	await expect(page.getByLabel("Temporary password", { exact: true })).toHaveCount(0);
});

test("unknown status prevents writes and offers a read-only retry", async ({ page }) => {
	let writes = 0;
	await page.route("**/api/admin/platform-clients/status", route => route.fulfill({ status: 403, json: { error: "Access changed" } }));
	await page.route("**/api/admin/platform-clients", route => { writes++; return route.abort(); });
	await openForm(page);
	await page.getByRole("button", { name: "Review setup", exact: true }).click();
	await expect(page.getByRole("alert")).toContainText("Check status again before creating");
	await expect(page.getByRole("button", { name: "Create client", exact: true })).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Check status", exact: true })).toBeEnabled();
	expect(writes).toBe(0);
});

test("a late status response cannot restore a review after editing or closing", async ({ page }) => {
	const pending = Promise.withResolvers<void>();
	const started = Promise.withResolvers<void>();
	await page.route("**/api/admin/platform-clients/status", async route => {
		started.resolve();
		await pending.promise;
		await route.fulfill({ json: matching }).catch(() => {});
	});
	await openForm(page);
	await page.getByRole("button", { name: "Review setup", exact: true }).click();
	await started.promise;
	await page.getByRole("button", { name: "Edit details", exact: true }).click();
	await page.getByLabel("Business name", { exact: true }).fill("Edited business");
	await page.getByRole("button", { name: "Cancel", exact: true }).click();
	pending.resolve();
	await page.getByRole("button", { name: "Add platform client", exact: true }).click();
	await expect(page.getByLabel("Business name", { exact: true })).toHaveValue("");
	await expect(page.getByText("Password handoff is unconfirmed.", { exact: true })).toHaveCount(0);
});

test("a prepared plan pins its website and travels with the exact reviewed intent", async ({ page }, testInfo) => {
	const plan = {
		version: 1, kind: "client-setup",
		identity: { repository: "operator/cedar", siteUrl, expectedTenantId: null, environmentId: "staging", sourceRevision: "a".repeat(40), sourceFingerprint: "b".repeat(64), contractFingerprint: "c".repeat(64) },
		target: { publicOrigin: "https://stage.cedarfinch.example", convexUrl: "https://fixture.convex.cloud", convexSiteUrl: "https://fixture.convex.site" },
	};
	let reads = 0;
	let writes = 0;
	await page.route("**/api/admin/platform-clients/status", route => {
		reads++;
		expect(route.request().postDataJSON()).toEqual({ ...input, setupPlan: plan });
		return route.fulfill({ json: absent });
	});
	await page.route("**/api/admin/platform-clients", route => {
		writes++;
		expect(route.request().postDataJSON()).toEqual({ ...input, setupPlan: plan });
		return route.fulfill({ json: { kind: "observed", status: matching } });
	});
	await openForm(page);
	await page.getByLabel("Setup plan (optional)").setInputFiles({ name: "prepared.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(plan)) });
	await expect(page.getByLabel("Website hostname")).toHaveValue(siteUrl);
	await expect(page.getByLabel("Website hostname")).toBeDisabled();
	await review(page);
	await expect(page.getByText("https://stage.cedarfinch.example", { exact: true })).toBeVisible();
	await page.screenshot({ path: `/tmp/angelsrest-resume25-review-${testInfo.project.name}.png` });
	await page.getByRole("button", { name: "Create client", exact: true }).click();
	await expect(page.getByText("Password handoff is unconfirmed.", { exact: true })).toBeVisible();
	expect(reads).toBe(1);
	expect(writes).toBe(1);
});


test("an invalid or oversized setup file must be replaced or explicitly removed before review", async ({ page }) => {
	await openForm(page);
	const picker = page.getByLabel("Setup plan (optional)");
	await picker.setInputFiles({ name: "invalid.json", mimeType: "application/json", buffer: Buffer.from('{"kind":"client-setup","token":"fixture"}') });
	await expect(page.getByRole("alert")).toContainText("not a prepared client setup plan");
	await page.getByLabel("Business name", { exact: true }).fill("Edited business");
	await expect(page.getByRole("button", { name: "Review setup", exact: true })).toBeDisabled();
	await picker.setInputFiles({ name: "oversized.json", mimeType: "application/json", buffer: Buffer.alloc(16_385, " ") });
	await expect(page.getByRole("alert")).toContainText("not a prepared client setup plan");
	await expect(page.getByRole("button", { name: "Review setup", exact: true })).toBeDisabled();
	await page.getByRole("button", { name: "Remove plan", exact: true }).click();
	await expect(page.getByRole("button", { name: "Review setup", exact: true })).toBeEnabled();
});

test("an uncertain creation followed by an unavailable readback cannot offer another write", async ({ page }) => {
	let reads = 0;
	let writes = 0;
	await page.route("**/api/admin/platform-clients/status", route => ++reads === 1
		? route.fulfill({ json: absent }) : route.fulfill({ status: 503, json: { error: "Unavailable" } }));
	await page.route("**/api/admin/platform-clients", route => { writes++; return route.abort(); });
	await openForm(page);
	await review(page);
	await page.getByRole("button", { name: "Create client", exact: true }).click();
	await expect(page.getByRole("alert")).toContainText("Client creation is unconfirmed");
	await expect(page.getByRole("button", { name: "Retry creation", exact: true })).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Check status", exact: true })).toBeEnabled();
	expect(writes).toBe(1);
	expect(reads).toBe(2);
});


test("a timed-out write gets one fresh status request and a timed-out readback unlocks recovery", async ({ page }) => {
	let reads = 0;
	let writes = 0;
	const pending = Promise.withResolvers<void>();
	const mutationStarted = Promise.withResolvers<void>();
	const readbackStarted = Promise.withResolvers<void>();
	await page.route("**/api/admin/platform-clients/status", async route => {
		if (++reads === 1) return route.fulfill({ json: absent });
		readbackStarted.resolve();
		await pending.promise;
		await route.fulfill({ json: matching }).catch(() => {});
	});
	await page.route("**/api/admin/platform-clients", async route => {
		writes++;
		mutationStarted.resolve();
		await pending.promise;
		await route.fulfill({ json: { kind: "created", email: input.email, temporaryPassword: "Late-Fixture-Password" } }).catch(() => {});
	});
	await page.clock.install();
	await openForm(page);
	await review(page);
	await page.getByRole("button", { name: "Create client", exact: true }).click();
	await mutationStarted.promise;
	// Pending fetches must retain cancellation even when WebKit collects unused signals.
	await page.requestGC();
	await page.clock.fastForward(20_001);
	await readbackStarted.promise;
	await expect(page.getByRole("button", { name: "Adding client…" })).toBeDisabled();
	await page.requestGC();
	await page.clock.fastForward(20_001);
	await expect(page.getByRole("alert")).toContainText("Client creation is unconfirmed");
	await expect(page.getByRole("button", { name: "Check status", exact: true })).toBeEnabled();
	await expect(page.getByRole("button", { name: "Retry creation", exact: true })).toHaveCount(0);
	await page.getByRole("button", { name: "Edit details", exact: true }).click();
	await page.getByRole("button", { name: "Cancel", exact: true }).click();
	pending.resolve();
	await expect(page.getByLabel("Temporary password", { exact: true })).toHaveCount(0);
	expect(reads).toBe(2);
	expect(writes).toBe(1);
});
