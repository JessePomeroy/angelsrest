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

const tenantId = "tenant_05eb6092-5d8c-43ce-ad26-1a59522bd07b";
const clientEntry = { siteUrl: "third.example", tenantId, state: "open", generation: 3 };
const clientRegistry = (tenants: unknown[] = [clientEntry]) => JSON.stringify({ version: 2, tenants });

afterEach(() => {
	delete process.env.NEW_ORDER_ADMISSION_CONTROL;
	delete process.env.NEW_PROVIDER_SUBMISSION_CONTROL;
});

describe("commerce purpose controls", () => {
	test("admits only explicitly listed version-2 domains and pins their tenant identity", () => {
		expect(parseCommerceControlRegistry(clientRegistry(), "third.example")).toEqual({
			state: "open", generation: 3, valid: true, tenantId,
		});
		for (const site of ["fourth.example", "angelsrest.online", "www.third.example"]) {
			expect(parseCommerceControlRegistry(clientRegistry(), site)).toEqual({
				state: "closed", generation: null, valid: false,
			});
		}
	});

	test.each([
		"https://third.example", "www.third.example", "Third.example", "third.example/",
		" third.example", "third.example:443", "third..example", "-third.example",
		"third-.example", "third_example.com", "third.example.", "localhost", "127.0.0.1",
		`${"a".repeat(64)}.example`, `${"a.".repeat(126)}example`,
	])("rejects a noncanonical version-2 domain: %s", siteUrl => {
		expect(parseCommerceControlRegistry(clientRegistry([clientEntry, {
			...clientEntry, siteUrl,
		}]), clientEntry.siteUrl).valid).toBe(false);
	});

	test("rejects invalid, missing, duplicate or extra version-2 entry fields", () => {
		for (const entry of [
			{ siteUrl: clientEntry.siteUrl, state: "open", generation: 3 },
			{ ...clientEntry, tenantId: "third.example" },
			{ ...clientEntry, generation: Number.MAX_SAFE_INTEGER + 1 },
			{ ...clientEntry, state: "enabled" },
			{ ...clientEntry, extra: true },
		]) expect(parseCommerceControlRegistry(clientRegistry([entry]), clientEntry.siteUrl).valid).toBe(false);
		expect(parseCommerceControlRegistry(clientRegistry([clientEntry, clientEntry]), clientEntry.siteUrl).valid).toBe(false);
	});

	test("bounds version 2 separately while preserving version-1 byte limits", () => {
		const entries = Array.from({ length: 100 }, (_, index) => ({ ...clientEntry, siteUrl: `client${index}.example` }));
		expect(parseCommerceControlRegistry(clientRegistry(entries), "client0.example").valid).toBe(true);
		expect(parseCommerceControlRegistry(clientRegistry([...entries, clientEntry]), "client0.example").valid).toBe(false);
		expect(parseCommerceControlRegistry(`${" ".repeat(65_536)}${clientRegistry()}`, clientEntry.siteUrl).valid).toBe(false);
		expect(parseCommerceControlRegistry(`${" ".repeat(4096)}${exactRegistry}`, "angelsrest.online").valid).toBe(false);
		expect(parseCommerceControlRegistry(clientRegistry([{ ...clientEntry, state: "closed" }]), clientEntry.siteUrl)).toEqual({
			state: "closed", generation: 3, valid: true, tenantId,
		});
	});
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
