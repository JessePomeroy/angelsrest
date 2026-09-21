import { describe, expect, test } from "vitest";
import { parseAdmissionMarkCreatingRequest } from "./checkoutAdmission";
import {
	financialIntentMatchesSnapshot,
	freezeCheckoutFinancialSnapshot,
	parseCheckoutFinancialIntent,
} from "./checkoutFinancialSnapshot";
import type { ReservedCheckoutSnapshot } from "./checkoutSnapshot";

const identity = {
	tenantId: "tenant_05eb6092-5d8c-43ce-ad26-1a59522bd07b",
	stripePlatformAccountId: "acct_platform1234567890",
	stripeConnectedAccountId: "acct_client12345678901",
	stripeLivemode: false,
};
const intent = { version: 1 as const, currency: "usd" as const,
	lines: [{ unitPriceCents: 10_019, quantity: 2 }, { unitPriceCents: 12_019, quantity: 1 }, { unitPriceCents: 1000, quantity: 3 }],
	applicationFeeAmountCents: 1602 };
const snapshot: ReservedCheckoutSnapshot = { schemaVersion: 1, catalogProvider: "convex",
	items: (["print", "print_set", "merchandise"] as const).map((productKind, index) => ({
		productKey: `product-${index}`, revisionId: `revision-${index}`, productKind, variantKey: "default",
		materialOptionKey: null, sizeOptionKey: null, borderOptionKey: null, frameOptionKey: null,
	})) };
const freeze = (value = intent) => freezeCheckoutFinancialSnapshot({ intent: value, snapshot,
	unitAmounts: [10_019, 12_019, 1000], identity });

describe("original checkout financial snapshot", () => {
	test("freezes the exact print base and fee separately from the whole product subtotal", () => {
		expect(freeze()).toEqual({ version: 1, policy: "print_subtotal_5pct_floor_v1", ...identity,
			currency: "usd", subtotalCents: 35_057, printSubtotalCents: 32_057, applicationFeeAmountCents: 1602,
			lines: intent.lines.map((line, index) => ({ ...line, productKind: snapshot.items[index]?.productKind })),
		});
	});

	test.each([
		{ currency: "eur" }, { version: 2 }, { extra: true }, { lines: [] },
		{ lines: Array(41).fill({ unitPriceCents: 10, quantity: 1 }) },
		{ lines: [{ unitPriceCents: -1, quantity: 1 }] },
		{ lines: [{ unitPriceCents: 1.5, quantity: 1 }] },
		{ lines: [{ unitPriceCents: Infinity, quantity: 1 }] },
		{ lines: [{ unitPriceCents: 100, quantity: 21 }] },
		{ lines: [{ unitPriceCents: 100, quantity: 0 }] },
		{ lines: [{ unitPriceCents: 100, quantity: 0.5 }] },
		{ lines: [{ unitPriceCents: Number.MAX_SAFE_INTEGER, quantity: 2 }] },
		{ applicationFeeAmountCents: NaN }, { applicationFeeAmountCents: 35_058 },
	])("rejects malformed or unbounded intents %j", (override) => {
		expect(parseCheckoutFinancialIntent({ ...intent, ...override })).toBeNull();
	});

	test("rejects host amounts and fees that differ from the frozen catalog policy", () => {
		expect(() => freeze({ ...intent, applicationFeeAmountCents: 1603 })).toThrow("fee does not match");
		expect(() => freeze({ ...intent, lines: [{ unitPriceCents: 1, quantity: 2 }, ...intent.lines.slice(1)] })).toThrow("frozen catalog prices");
		expect(() => freeze({ ...intent, lines: intent.lines.slice(1) })).toThrow("identity is invalid");
	});

	test("compares replays with saved amounts, without consulting a changed catalog", () => {
		const saved = freeze();
		expect(financialIntentMatchesSnapshot(intent, saved)).toBe(true);
		expect(financialIntentMatchesSnapshot({ ...intent, applicationFeeAmountCents: 1603 }, saved)).toBe(false);
		expect(financialIntentMatchesSnapshot({ ...intent, lines: [{ ...intent.lines[0]!, quantity: 1 }, ...intent.lines.slice(1)] }, saved)).toBe(false);
	});

	test("the admission parser requires a snapshot handle and an exact financial envelope", () => {
		const body = { version: 1, site: "client.example", admissionId: "admission_123",
			activeLeaseTokenHash: "a".repeat(64), requestFingerprint: "b".repeat(64), stripeIdempotencyDigest: "c".repeat(64),
			checkoutSnapshotHandle: "123e4567-e89b-42d3-a456-426614174000", financialIntent: intent };
		expect(parseAdmissionMarkCreatingRequest(body)).toMatchObject({ financialIntent: intent });
		expect(parseAdmissionMarkCreatingRequest({ ...body, financialIntent: { ...intent, feeId: "fee_forged" } })).toBeNull();
		const { checkoutSnapshotHandle: _, ...missingHandle } = body;
		expect(parseAdmissionMarkCreatingRequest(missingHandle)).toBeNull();
	});
});
