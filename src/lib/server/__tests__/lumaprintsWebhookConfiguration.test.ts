import { beforeEach, expect, it, vi } from "vitest";
import { resolveLumaPrintsWebhookConfiguration } from "../lumaprintsConnections";

const { privateEnv } = vi.hoisted(() => ({ privateEnv: {} as Record<string, string | undefined> }));
vi.mock("$env/dynamic/private", () => ({ env: privateEnv }));
const connection = {
	version: 1,
	connectionRef: "lp_client_one",
	tenantId: "tenant_11111111-1111-4111-8111-111111111111",
	storeId: 101,
	environment: "sandbox",
} as const;
const other = { ...connection, connectionRef: "lp_client_two", storeId: 102 };
function registry() {
	privateEnv.LUMAPRINTS_CONNECTIONS = JSON.stringify({
		version: 1,
		connections: [
			{ ...connection, credentialRef: "ONE" },
			{ ...other, credentialRef: "TWO" },
		],
	});
}
beforeEach(() => {
	for (const key of Object.keys(privateEnv)) delete privateEnv[key];
	registry();
	Object.assign(privateEnv, {
		LUMAPRINTS_CONNECTION_ONE_WEBHOOK_USERNAME: "one",
		LUMAPRINTS_CONNECTION_ONE_WEBHOOK_PASSWORD: "current-one",
		LUMAPRINTS_CONNECTION_ONE_WEBHOOK_PASSWORD_PREVIOUS: "previous-one",
		LUMAPRINTS_CONNECTION_TWO_WEBHOOK_USERNAME: "two",
		LUMAPRINTS_CONNECTION_TWO_WEBHOOK_PASSWORD: "current-two",
		LUMAPRINTS_WEBHOOK_USERNAME: "central",
		LUMAPRINTS_WEBHOOK_PASSWORD: "central-password",
	});
});

it("captures only the exact non-secret identity and dedicated webhook credential pair", () => {
	const resolved = resolveLumaPrintsWebhookConfiguration(connection.connectionRef);
	expect(resolved).toEqual({
		connection,
		username: "one",
		password: "current-one",
		previousPassword: "previous-one",
	});
	privateEnv.LUMAPRINTS_CONNECTION_ONE_WEBHOOK_PASSWORD = "rotated";
	expect(resolved.password).toBe("current-one");
	expect(resolveLumaPrintsWebhookConfiguration(connection.connectionRef).password).toBe("rotated");
	expect(Object.isFrozen(resolved.connection)).toBe(true);
});

it.each([
	"",
	"lp_unknown_one",
	"bad-reference",
	`lp_${"x".repeat(81)}`,
])("refuses an invalid or unknown reference %s without central fallback", (reference) => {
	expect(() => resolveLumaPrintsWebhookConfiguration(reference)).toThrow(
		"configuration is unavailable",
	);
});

it.each([
	["USERNAME", undefined],
	["PASSWORD", undefined],
	["USERNAME", "with:colon"],
	["PASSWORD", "with\nnewline"],
	["PASSWORD", "x".repeat(513)],
	["PASSWORD_PREVIOUS", ""],
])("rejects invalid dedicated %s configuration", (suffix, value) => {
	privateEnv[`LUMAPRINTS_CONNECTION_ONE_WEBHOOK_${suffix}`] = value;
	expect(() => resolveLumaPrintsWebhookConfiguration(connection.connectionRef)).toThrow(
		"configuration is unavailable",
	);
});

it.each([
	["LUMAPRINTS", "PASSWORD", "PASSWORD"],
	["LUMAPRINTS", "PASSWORD", "PASSWORD_PREVIOUS"],
	["LUMAPRINTS", "PASSWORD_PREVIOUS", "PASSWORD"],
	["LUMAPRINTS", "PASSWORD_PREVIOUS", "PASSWORD_PREVIOUS"],
	["LUMAPRINTS_CONNECTION_TWO", "PASSWORD", "PASSWORD"],
	["LUMAPRINTS_CONNECTION_TWO", "PASSWORD", "PASSWORD_PREVIOUS"],
	["LUMAPRINTS_CONNECTION_TWO", "PASSWORD_PREVIOUS", "PASSWORD"],
	["LUMAPRINTS_CONNECTION_TWO", "PASSWORD_PREVIOUS", "PASSWORD_PREVIOUS"],
])("rejects shared authentication with %s including rotation overlap (%s/%s)", (prefix, own, theirs) => {
	privateEnv[`${prefix}_WEBHOOK_USERNAME`] = "one";
	privateEnv[`${prefix}_WEBHOOK_${theirs}`] =
		privateEnv[`LUMAPRINTS_CONNECTION_ONE_WEBHOOK_${own}`];
	expect(() => resolveLumaPrintsWebhookConfiguration(connection.connectionRef)).toThrow(
		"configuration is unavailable",
	);
	expect(() =>
		resolveLumaPrintsWebhookConfiguration(
			prefix === "LUMAPRINTS" ? undefined : other.connectionRef,
		),
	).toThrow("configuration is unavailable");
});

it("allows a shared username with distinct passwords and tolerates another connection's absent secrets", () => {
	privateEnv.LUMAPRINTS_CONNECTION_TWO_WEBHOOK_USERNAME = "one";
	expect(resolveLumaPrintsWebhookConfiguration(connection.connectionRef).connection).toEqual(
		connection,
	);
	delete privateEnv.LUMAPRINTS_CONNECTION_TWO_WEBHOOK_PASSWORD;
	expect(resolveLumaPrintsWebhookConfiguration(connection.connectionRef).connection).toEqual(
		connection,
	);
});

it("keeps legacy configuration independent when no client registry exists", () => {
	delete privateEnv.LUMAPRINTS_CONNECTIONS;
	expect(resolveLumaPrintsWebhookConfiguration()).toEqual({
		connection: undefined,
		username: "central",
		password: "central-password",
		previousPassword: undefined,
	});
});

it("fails central intake closed on a malformed configured client registry", () => {
	privateEnv.LUMAPRINTS_CONNECTIONS = "bad-json";
	expect(() => resolveLumaPrintsWebhookConfiguration()).toThrow("configuration is unavailable");
});
