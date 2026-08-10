import { afterEach, describe, expect, test } from "vitest";
import {
	checkedAcceptUntilMs,
	commerceControlDecisionFromEnvironment,
	COMMERCE_CONTROL_ENV,
	parseCommerceControlRegistry,
} from "./commercePurposeControl";

const exactRegistry = JSON.stringify({
	version: 1,
	tenants: [
		{ siteUrl: "angelsrest.online", state: "open", generation: 1 },
		{ siteUrl: "zippymiggy.com", state: "closed", generation: 2 },
	],
});

afterEach(() => {
	delete process.env.NEW_ORDER_ADMISSION_CONTROL;
	delete process.env.NEW_PROVIDER_SUBMISSION_CONTROL;
});

describe("commerce purpose controls", () => {
	test("resolves the exact complete tenant registry", () => {
		expect(parseCommerceControlRegistry(exactRegistry, "angelsrest.online")).toEqual({
			state: "open",
			generation: 1,
			valid: true,
		});
		expect(parseCommerceControlRegistry(exactRegistry, "zippymiggy.com")).toEqual({
			state: "closed",
			generation: 2,
			valid: true,
		});
	});

	test.each([
		undefined,
		"",
		"not-json",
		JSON.stringify({ version: 2, tenants: [] }),
		JSON.stringify({ version: 1, tenants: [] }),
		JSON.stringify({ version: 1, tenants: [
			{ siteUrl: "angelsrest.online", state: "open", generation: 1 },
			{ siteUrl: "angelsrest.online", state: "open", generation: 1 },
		] }),
		JSON.stringify({ version: 1, tenants: [
			{ siteUrl: "angelsrest.online", state: " open", generation: 1 },
			{ siteUrl: "zippymiggy.com", state: "open", generation: 1 },
		] }),
		JSON.stringify({ version: 1, tenants: [
			{ siteUrl: "angelsrest.online", state: "open", generation: 0 },
			{ siteUrl: "zippymiggy.com", state: "open", generation: 1 },
		] }),
		JSON.stringify({ version: 1, tenants: [
			{ siteUrl: "angelsrest.online", state: "open", generation: 1, extra: true },
			{ siteUrl: "zippymiggy.com", state: "open", generation: 1 },
		] }),
		JSON.stringify({ version: 1, tenants: [
			{ siteUrl: "angelsrest.online", state: "open", generation: 1 },
			{ siteUrl: "third.example", state: "open", generation: 1 },
		] }),
		"x".repeat(4097),
	])("fails closed without projecting invalid input: %p", (value) => {
		expect(parseCommerceControlRegistry(value, "angelsrest.online")).toEqual({
			state: "closed",
			generation: null,
			valid: false,
		});
	});

	test("uses a purpose-specific environment name", () => {
		process.env[COMMERCE_CONTROL_ENV.new_order_admission] = exactRegistry;
		expect(commerceControlDecisionFromEnvironment(
			"new_order_admission",
			"angelsrest.online",
		)).toMatchObject({ state: "open", generation: 1, valid: true });
		expect(commerceControlDecisionFromEnvironment(
			"new_provider_submission",
			"angelsrest.online",
		)).toMatchObject({ state: "closed", generation: null, valid: false });
	});

	test("computes the exact checked 37d7h horizon", () => {
		expect(checkedAcceptUntilMs(1_700_000_000)).toBe(1_703_222_000_000);
		expect(() => checkedAcceptUntilMs(Number.MAX_SAFE_INTEGER)).toThrow(/unsafe/);
	});
});
