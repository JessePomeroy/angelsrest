import { describe, expect, it } from "vitest";
import {
	checkoutCredentialFingerprint,
	getCheckoutBridgeTenantConfig as getBridgeConfig,
	getCheckoutSnapshotReservationCredential as getReservationCredential,
	parseCheckoutBridgeTenantRegistry,
} from "../checkoutBridgeConfig";

const PRIMARY_SECRET = "p".repeat(32);
const RESERVATION_SECRET = "r".repeat(32);

function fingerprintManifest(
	bridgeSecrets = [PRIMARY_SECRET],
	reservationSecrets = [RESERVATION_SECRET],
) {
	return JSON.stringify({
		checkoutBridge: bridgeSecrets.map(checkoutCredentialFingerprint),
		checkoutSnapshotReservation: reservationSecrets.map(checkoutCredentialFingerprint),
	});
}

const reservationRegistry = JSON.stringify({ "angelsrest.test": [RESERVATION_SECRET] });

function registry(
	overrides: Record<string, unknown> = {},
	additionalTenants: Record<string, unknown> = {},
) {
	return JSON.stringify({
		"zippymiggy.com": {
			secrets: [PRIMARY_SECRET],
			redirectOrigins: ["https://reflecting-pool.vercel.app", "https://margarethelena.com"],
			...overrides,
		},
		...additionalTenants,
	});
}

function getCheckoutSnapshotReservationCredential(
	site: string,
	reservation = reservationRegistry,
	manifest = fingerprintManifest(),
	bridge = registry(),
) {
	return getReservationCredential(site, reservation, manifest, bridge);
}

function getCheckoutBridgeTenantConfig(
	site: string,
	bridge = registry(),
	manifest = fingerprintManifest(),
	reservation = reservationRegistry,
) {
	return getBridgeConfig(site, bridge, manifest, reservation);
}

describe("checkout bridge tenant registry", () => {
	it("selects only the current approved tenant reservation credential", () => {
		const previous = "o".repeat(32);
		const reservationRegistry = JSON.stringify({
			"angelsrest.test": [RESERVATION_SECRET, previous],
		});
		const manifest = fingerprintManifest([PRIMARY_SECRET], [RESERVATION_SECRET, previous]);
		expect(
			getCheckoutSnapshotReservationCredential("angelsrest.test", reservationRegistry, manifest),
		).toBe(RESERVATION_SECRET);
		expect(() =>
			getCheckoutSnapshotReservationCredential("other.test", reservationRegistry, manifest),
		).toThrow("unavailable");
	});

	it("fails reservation authority closed for absent, incomplete, duplicate, or overlapping roles", () => {
		const valid = JSON.stringify({ "angelsrest.test": [RESERVATION_SECRET] });
		expect(() =>
			getReservationCredential("angelsrest.test", undefined, undefined, registry()),
		).toThrow("unavailable");
		expect(() =>
			getCheckoutSnapshotReservationCredential(
				"angelsrest.test",
				valid,
				fingerprintManifest([PRIMARY_SECRET], ["different".repeat(4)]),
			),
		).toThrow("unavailable");
		expect(() =>
			getCheckoutSnapshotReservationCredential(
				"angelsrest.test",
				JSON.stringify({ a: [RESERVATION_SECRET], b: [RESERVATION_SECRET] }),
				fingerprintManifest(),
			),
		).toThrow("unavailable");
		expect(() =>
			getCheckoutSnapshotReservationCredential(
				"angelsrest.test",
				valid,
				fingerprintManifest([RESERVATION_SECRET], [RESERVATION_SECRET]),
			),
		).toThrow("unavailable");
	});
	it("resolves only the configured tenant authority", () => {
		expect(getCheckoutBridgeTenantConfig("zippymiggy.com", registry())).toEqual({
			secrets: [PRIMARY_SECRET],
			redirectOrigins: ["https://reflecting-pool.vercel.app", "https://margarethelena.com"],
		});
		expect(getCheckoutBridgeTenantConfig("future-client.com", registry())).toBeNull();
		expect(
			getCheckoutBridgeTenantConfig("zippymiggy.com", registry({ snapshotMode: "handle-v2" })),
		).toMatchObject({ snapshotMode: "handle-v2" });
	});

	it("keeps configured tenant secrets isolated", () => {
		const futureSecret = "f".repeat(32);
		const twoTenantRegistry = registry(
			{},
			{
				"future-client.com": {
					secrets: [futureSecret],
					redirectOrigins: ["https://future-client.com"],
				},
			},
		);
		expect(
			getCheckoutBridgeTenantConfig(
				"future-client.com",
				twoTenantRegistry,
				fingerprintManifest([PRIMARY_SECRET, futureSecret]),
			),
		).toEqual({
			secrets: [futureSecret],
			redirectOrigins: ["https://future-client.com"],
		});
		expect(
			getCheckoutBridgeTenantConfig(
				"zippymiggy.com",
				twoTenantRegistry,
				fingerprintManifest([PRIMARY_SECRET, futureSecret]),
			)?.secrets,
		).toEqual([PRIMARY_SECRET]);
	});

	it("fails both checkout roles closed for missing, extra, overlap, or misassignment", () => {
		expect(() =>
			getBridgeConfig("zippymiggy.com", registry(), undefined, reservationRegistry),
		).toThrow();
		expect(() =>
			getReservationCredential(
				"angelsrest.test",
				reservationRegistry,
				fingerprintManifest(),
				undefined,
			),
		).toThrow("unavailable");
		expect(() =>
			getCheckoutBridgeTenantConfig(
				"zippymiggy.com",
				registry(),
				fingerprintManifest([PRIMARY_SECRET], [PRIMARY_SECRET]),
			),
		).toThrow("overlap");
		expect(() =>
			getCheckoutBridgeTenantConfig(
				"zippymiggy.com",
				registry(),
				fingerprintManifest(["different".repeat(4)]),
			),
		).toThrow("do not match");
		expect(() =>
			getCheckoutBridgeTenantConfig(
				"zippymiggy.com",
				registry(),
				fingerprintManifest([RESERVATION_SECRET], [PRIMARY_SECRET]),
			),
		).toThrow("do not match");
		expect(() =>
			getCheckoutBridgeTenantConfig(
				"zippymiggy.com",
				registry(),
				fingerprintManifest([PRIMARY_SECRET, "x".repeat(32)]),
			),
		).toThrow("do not match");
		expect(
			getCheckoutBridgeTenantConfig("zippymiggy.com", registry(), fingerprintManifest()),
		).toMatchObject({ secrets: [PRIMARY_SECRET] });
	});

	it("fails closed for missing, malformed, or empty registries", () => {
		expect(() => parseCheckoutBridgeTenantRegistry(undefined)).toThrow("not configured");
		expect(() => parseCheckoutBridgeTenantRegistry("not-json")).toThrow("invalid JSON");
		expect(() => parseCheckoutBridgeTenantRegistry("{}")).toThrow("tenant count");
		expect(() => parseCheckoutBridgeTenantRegistry(registry({ snapshotMode: "legacy" }))).toThrow(
			"snapshot mode",
		);
	});

	it("requires bounded secrets and explicit HTTPS origins", () => {
		expect(() => parseCheckoutBridgeTenantRegistry(registry({ secrets: ["short"] }))).toThrow(
			"Invalid checkout bridge secret",
		);
		expect(() =>
			parseCheckoutBridgeTenantRegistry(
				registry({ redirectOrigins: ["https://example.com/path"] }),
			),
		).toThrow("must be origins");
		expect(() =>
			parseCheckoutBridgeTenantRegistry(registry({ redirectOrigins: ["http://example.com"] })),
		).toThrow("must use HTTPS");
		expect(() =>
			parseCheckoutBridgeTenantRegistry(
				registry({ secrets: [PRIMARY_SECRET, "s".repeat(32), "t".repeat(32)] }),
			),
		).toThrow("Invalid checkout bridge secrets");
	});
});
