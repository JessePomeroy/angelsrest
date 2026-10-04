import { expect, test } from "@playwright/test";

test("shows the observed release, scoped checks, compatibility gap and next action", async ({
	page,
}) => {
	await page.goto("/?fixture=platform-release-status");
	const panel = page.getByRole("region", { name: "Release status" });
	await expect(panel.getByText("Required checks passed", { exact: true })).toBeVisible();
	await expect(
		panel.getByText("Requested package versions match. Runtime compatibility is unverified."),
	).toBeVisible();
	await expect(panel.getByText("Verify the required backend and Worker contracts.")).toBeVisible();
	await expect(panel.getByText("6.7.1", { exact: true })).toHaveCount(2);
	await panel.getByText("Evidence and recovery reference", { exact: true }).click();
	await expect(panel.getByText("The CI build used fixture configuration.")).toBeVisible();
	await expect(panel.getByText("Capability activation has not been observed.")).toBeVisible();
	await expect(panel.getByText("dpl_syntheticCedar", { exact: true })).toBeVisible();
});

test("a website change hides the previous website's evidence while its response is stale", async ({
	page,
}) => {
	await page.goto("/?fixture=platform-release-status&state=stale");
	await page.getByLabel("Website", { exact: true }).selectOption("willow.example");
	await expect(page.getByText("Loading release evidence…", { exact: true })).toBeVisible();
	await expect(page.getByRole("link", { name: "aaaaaaaaaaaa", exact: true })).toHaveCount(0);
	await expect(page.getByText("Required checks passed", { exact: true })).toHaveCount(0);
	await page.getByRole("button", { name: "Complete delayed response" }).click();
	await expect(page.getByRole("heading", { name: "No release evidence recorded" })).toBeVisible();
});

test("missing observations stay unknown and never show passing release status", async ({
	page,
}) => {
	await page.goto("/?fixture=platform-release-status&state=unknown");
	await expect(page.getByText("Verification incomplete", { exact: true })).toBeVisible();
	await expect(page.getByText("Current deployment unknown.", { exact: true })).toBeVisible();
	await expect(page.getByText("No reviewed intent recorded.", { exact: true })).toBeVisible();
	await expect(page.getByText("Not recorded", { exact: true })).toHaveCount(2);
	await expect(page.getByText("Required checks passed", { exact: true })).toHaveCount(0);
});

test("failed upgrades show the earlier recovery reference and a concrete next action", async ({
	page,
}) => {
	await page.goto("/?fixture=platform-release-status&state=failed");
	await expect(page.getByText("Release needs attention", { exact: true })).toBeVisible();
	await expect(
		page.getByText("Investigate the failed release before adopting another update."),
	).toBeVisible();
	await page.getByText("Evidence and recovery reference", { exact: true }).click();
	await expect(page.getByText("dpl_syntheticCedar", { exact: true })).toBeVisible();
	await expect(page.getByRole("link", { name: "ffffffffffff", exact: true })).toBeVisible();
});

test("empty, loading and unavailable states explain the next step without showing stale success", async ({
	page,
}) => {
	for (const state of ["empty", "loading", "error"]) {
		await page.goto(`/?fixture=platform-release-status&state=${state}`);
		if (state === "empty")
			await expect(page.getByRole("link", { name: "Open the release runbook" })).toBeVisible();
		if (state === "loading")
			await expect(
				page.getByRole("status").filter({ hasText: "Loading release evidence" }),
			).toBeVisible();
		if (state === "error")
			await expect(page.getByRole("button", { name: "Reload page" })).toBeVisible();
		await expect(page.getByText("Required checks passed", { exact: true })).toHaveCount(0);
	}
});

test("keyboard selection and native evidence disclosure remain operable", async ({ page }) => {
	await page.goto("/?fixture=platform-release-status");
	const website = page.getByLabel("Website", { exact: true });
	await website.focus();
	await expect(website).toBeFocused();
	const disclosure = page.getByText("Evidence and recovery reference", { exact: true });
	await disclosure.focus();
	await page.keyboard.press("Enter");
	await expect(page.getByText("The CI build used fixture configuration.")).toBeVisible();
	await page.keyboard.press("Enter");
	await expect(page.getByText("The CI build used fixture configuration.")).toBeHidden();
});

test("the panel and expanded identifiers stay within narrow and wide viewports", async ({
	page,
}) => {
	for (const width of [390, 1440]) {
		await page.setViewportSize({ width, height: 1000 });
		await page.goto("/?fixture=platform-release-status");
		await page.getByText("Evidence and recovery reference", { exact: true }).click();
		const sizes = await page
			.getByRole("region", { name: "Release status" })
			.evaluate((element) => ({
				width: element.getBoundingClientRect().width,
				scroll: element.scrollWidth,
				viewport: document.documentElement.clientWidth,
				document: document.documentElement.scrollWidth,
			}));
		expect(sizes.scroll).toBeLessThanOrEqual(Math.ceil(sizes.width));
		expect(sizes.document).toBeLessThanOrEqual(sizes.viewport);
	}
});
