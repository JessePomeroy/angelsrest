import type Stripe from "stripe";
import { describe, expect, it } from "vitest";
import {
	CheckoutSnapshotProtocolError,
	decodeCheckoutSnapshot,
} from "$lib/server/checkoutSnapshotCodec";

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

function metadata(tuples: unknown[][], overrides: Record<string, string> = {}) {
	return {
		checkoutSnapshotVersion: "1",
		catalogProvider: "convex",
		checkoutSnapshotItemCount: String(tuples.length),
		...Object.fromEntries(
			tuples.map((item, ordinal) => [`checkoutSnapshotItem_${ordinal}`, JSON.stringify(item)]),
		),
		...overrides,
	};
}

const lineItems = (count: number) =>
	Array.from({ length: count }, (_, ordinal) => ({ id: `li_${ordinal}` }) as Stripe.LineItem);

describe("checkout snapshot V1 codec", () => {
	it("decodes an exact direct snapshot by Stripe line-item ordinal", () => {
		const snapshot = decodeCheckoutSnapshot(metadata([tuple(0)]), lineItems(1));
		expect(snapshot).toMatchObject({ schemaVersion: 1, catalogProvider: "convex" });
		expect(snapshot?.items[0]).toEqual({
			productKey: "p0",
			revisionId: "r0",
			productKind: "print",
			variantKey: "v0",
			materialOptionKey: "matte",
			sizeOptionKey: "8x10",
			borderOptionKey: null,
			frameOptionKey: null,
		});
	});

	it("preserves exact cart order instead of joining identities by name or amount", () => {
		const snapshot = decodeCheckoutSnapshot(
			metadata([tuple(0, "second-name"), tuple(1, "first-name")]),
			lineItems(2),
		);
		expect(snapshot?.items.map(({ productKey }) => productKey)).toEqual([
			"second-name",
			"first-name",
		]);
	});

	it("leaves metadata without checkoutSnapshotVersion on the legacy path", () => {
		expect(
			decodeCheckoutSnapshot(
				{
					isCart: "true",
					catalogProvider: "unknown",
					checkoutSnapshotItem_0: "not-json",
				},
				lineItems(1),
			),
		).toBeUndefined();
	});

	it.each([
		["unknown marker", metadata([tuple(0)], { checkoutSnapshotVersion: "2" }), lineItems(1)],
		[
			"explicit invalid marker",
			metadata([tuple(0)], { checkoutSnapshotVersion: "invalid" }),
			lineItems(1),
		],
		["unknown provider", metadata([tuple(0)], { catalogProvider: "shadow" }), lineItems(1)],
		["malformed tuple", metadata([tuple(0)], { checkoutSnapshotItem_0: "{" }), lineItems(1)],
		["partial tuple", metadata([[0, "product", "revision"]]), lineItems(1)],
		["extra tuple field", metadata([[...tuple(0), "paid-name"]]), lineItems(1)],
		["count mismatch", metadata([tuple(0)]), lineItems(2)],
		["order mismatch", metadata([tuple(1)]), lineItems(1)],
		["extra protocol field", metadata([tuple(0)], { checkoutSnapshotExtra: "x" }), lineItems(1)],
	])("fails closed for a marked %s without legacy fallback", (_label, meta, items) => {
		expect(() => decodeCheckoutSnapshot(meta, items)).toThrow(CheckoutSnapshotProtocolError);
	});
});
