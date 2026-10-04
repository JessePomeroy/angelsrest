import { expect, test } from "@playwright/test";

const fixture = (state: string) => `/?fixture=commerce-intake&state=${state}`;

test("blocked work shows its cause, scoped identities and an explicit recovery reason", async ({ page }) => {
	await page.goto(fixture("blocked"));
	await expect(page.getByRole("heading", { name: "Background intake" })).toBeVisible();
	await expect(page.getByText("Automatic attempts have reached their limit.")).toBeVisible();
	await expect(page.getByText("12 total · 12 this cycle")).toBeVisible();
	await page.getByText("Event details and recovery", { exact: true }).click();
	await expect(page.getByLabel("Recovery reason")).toBeVisible();
	await page.getByLabel("Recovery reason").selectOption("dependencies_restored");
	const form = page.locator("form.recovery");
	await expect(form).toHaveAttribute("method", "POST");
	await expect(form.locator('input[name="siteUrl"]')).toHaveValue("cedar.example");
	await expect(form.locator('input[name="expectedVersion"]')).toHaveValue("8");
	await expect(page.getByRole("link", { name: "Next 25 events" })).toHaveAttribute("href", /cursor=synthetic-next/);
	await expect(page.locator("body")).not.toContainText("eventJson");
});

test("receipt uncertainty only offers a check of persisted evidence", async ({ page }) => {
	await page.goto(fixture("uncertain"));
	await page.getByText("Event details and recovery", { exact: true }).click();
	await expect(page.getByLabel("Recovery reason").locator("option")).toHaveCount(2);
	await expect(page.getByLabel("Recovery reason").locator('option[value="persisted_outcome_verified"]')).toHaveText("Check the saved completion evidence");
});

for (const [state, message] of [["empty", "No matching events"], ["error", "Intake status is unavailable"], ["unauthorized", "Sign in with platform creator access to review intake."]] as const) {
	test(`${state} status is explicit`, async ({ page }) => {
		await page.goto(fixture(state));
		await expect(page.getByText(message, { exact: true })).toBeVisible();
		await expect(page.getByRole("button", { name: "Apply recovery" })).toHaveCount(0);
	});
}

test("completed and currently leased work have no recovery submission", async ({ page }) => {
	for (const state of ["done", "processing"]) {
		await page.goto(fixture(state));
		await page.getByText("Event details and recovery", { exact: true }).click();
		await expect(page.getByRole("button", { name: "Apply recovery" })).toHaveCount(0);
	}
});

test("native disclosures support keyboard access and the layout fits its viewport", async ({ page }) => {
	await page.goto(fixture("overdue"));
	const summary = page.getByText("Event details and recovery", { exact: true });
	await summary.focus(); await page.keyboard.press("Enter");
	await expect(page.getByLabel("Recovery reason")).toBeVisible();
	await expect(page.getByRole("heading", { name: "Waiting · Overdue" })).toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
