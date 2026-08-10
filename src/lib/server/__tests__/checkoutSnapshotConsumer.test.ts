import type Stripe from "stripe";
import { describe, expect, it } from "vitest";
import {
	CheckoutSnapshotProtocolError,
	hasCheckoutSnapshotMarker,
	inspectCheckoutAdmissionMetadata,
	inspectCheckoutSnapshotMetadata,
	selectCheckoutSnapshotInput,
} from "$lib/server/checkoutSnapshotConsumer";

const handle = "123e4567-e89b-42d3-a456-426614174000";
const tuple = (ordinal: number, productKey = `p${ordinal}`): unknown[] => [
	ordinal,
	productKey,
	`r${ordinal}`,
	"print",
	`v${ordinal}`,
	"matte",
	"8x10",
	null,
	null,
];

function inline(tuples: unknown[][], overrides: Record<string, string> = {}) {
	return {
		checkoutSnapshotVersion: "1",
		catalogProvider: "convex",
		checkoutSnapshotItemCount: String(tuples.length),
		...Object.fromEntries(
			tuples.map((item, ordinal) => [`checkoutSnapshotItem_${ordinal}`, JSON.stringify(item)]),
		),
		...overrides,
	} as Stripe.Metadata;
}

function inspect(metadata: Stripe.Metadata, count = 1) {
	return inspectCheckoutSnapshotMetadata(metadata, count);
}

describe("checkout snapshot protocol inspection", () => {
	it("accepts only the exact opaque admission marker", () => {
		expect(
			inspectCheckoutAdmissionMetadata({
				checkoutAdmissionVersion: "1",
				checkoutAdmissionHandleHash: "a".repeat(64),
			}),
		).toEqual({
			kind: "admission-v1",
			candidate: { version: 1, handleHash: "a".repeat(64) },
		});
		expect(
			inspectCheckoutAdmissionMetadata({
				checkoutAdmissionVersion: "1",
				checkoutAdmissionHandleHash: "not-a-digest",
			}),
		).toEqual({ kind: "invalid-marked" });
	});
	it("preserves exact bounded inline-v1 order", () => {
		const result = inspect(inline([tuple(0, "second"), tuple(1, "first")]), 2);
		expect(result.kind).toBe("inline-v1");
		if (result.kind !== "inline-v1") return;
		expect(result.snapshot.items.map(({ productKey }) => productKey)).toEqual(["second", "first"]);
		expect(result.snapshot.items[0]).toEqual({
			productKey: "second",
			revisionId: "r0",
			productKind: "print",
			variantKey: "v0",
			materialOptionKey: "matte",
			sizeOptionKey: "8x10",
			borderOptionKey: null,
			frameOptionKey: null,
		});
	});

	it("leaves literal historical metadata unmarked", () => {
		const metadata = { isCart: "true", cartItem_0: "not-json", catalogProvider: "old" };
		expect(hasCheckoutSnapshotMarker(metadata)).toBe(false);
		expect(inspect(metadata)).toEqual({ kind: "unmarked" });
	});

	it("detects malformed and future snapshot markers for fail-closed intake", () => {
		expect(hasCheckoutSnapshotMarker({ checkoutSnapshotFuture: "value" })).toBe(true);
		expect(hasCheckoutSnapshotMarker(null)).toBe(false);
	});

	it("accepts only the exact handle-v2 protocol fields and tenant marker", () => {
		expect(
			inspect({
				checkoutSnapshotVersion: "2",
				checkoutSnapshotHandle: handle,
				commerceTenantSiteUrl: "tenant.example",
				isCart: "true",
			}),
		).toEqual({ kind: "handle-v2", handle });
	});

	it.each([
		["unknown version", inline([tuple(0)], { checkoutSnapshotVersion: "3" })],
		["unknown provider", inline([tuple(0)], { catalogProvider: "shadow" })],
		["malformed tuple", inline([tuple(0)], { checkoutSnapshotItem_0: "{" })],
		["partial tuple", inline([[0, "product", "revision"]])],
		["extra tuple field", inline([[...tuple(0), "paid-name"]])],
		["order mismatch", inline([tuple(1)])],
		["extra protocol field", inline([tuple(0)], { checkoutSnapshotExtra: "x" })],
		["oversized identity", inline([tuple(0, "x".repeat(129))])],
		["handle without version", { checkoutSnapshotHandle: handle }],
		[
			"mixed handle and inline",
			{
				...inline([tuple(0)]),
				checkoutSnapshotVersion: "2",
				checkoutSnapshotHandle: handle,
				commerceTenantSiteUrl: "tenant.example",
			},
		],
		["handle without tenant", { checkoutSnapshotVersion: "2", checkoutSnapshotHandle: handle }],
	])("classifies %s as invalid-marked without throwing", (_label, metadata) => {
		expect(inspect(metadata as Stripe.Metadata)).toMatchObject({ kind: "invalid-marked" });
	});

	it("preflights inline structure before the paid line-item count is available", () => {
		expect(inspectCheckoutSnapshotMetadata(inline([tuple(0)]), undefined)).toMatchObject({
			kind: "inline-v1",
		});
	});

	it("rejects declared/actual count mismatch", () => {
		expect(inspect(inline([tuple(0)]), 2)).toMatchObject({ kind: "invalid-marked" });
	});
});

describe("checkout snapshot routing selection", () => {
	it("lets existing order authority bypass missing or malformed metadata", () => {
		expect(selectCheckoutSnapshotInput("order")).toEqual({ protocol: "existing-order" });
	});

	it("maps reservation and inline protocols to the one discriminated order input", () => {
		const v2 = inspect({
			checkoutSnapshotVersion: "2",
			checkoutSnapshotHandle: handle,
			commerceTenantSiteUrl: "tenant.example",
		});
		expect(selectCheckoutSnapshotInput("reservation", v2)).toEqual({
			protocol: "handle-v2",
			reservation: { version: 2, handle },
		});
		expect(selectCheckoutSnapshotInput("admission", v2)).toEqual({
			protocol: "handle-v2",
			reservation: { version: 2, handle },
		});
		expect(selectCheckoutSnapshotInput("admission", { kind: "unmarked" })).toEqual({
			protocol: "legacy",
		});
		const v1 = inspect(inline([tuple(0)]));
		expect(selectCheckoutSnapshotInput(null, v1)).toMatchObject({ protocol: "inline-v1" });
	});

	it.each([
		[
			"unknown handle",
			null,
			inspect({
				checkoutSnapshotVersion: "2",
				checkoutSnapshotHandle: handle,
				commerceTenantSiteUrl: "tenant.example",
			}),
		],
		["reservation without handle", "reservation", { kind: "unmarked" }],
		["invalid marker", null, { kind: "invalid-marked" }],
	] as const)("fails closed for %s", (_label, source, protocol) => {
		expect(() => selectCheckoutSnapshotInput(source, protocol)).toThrow(
			CheckoutSnapshotProtocolError,
		);
	});
});
