import { describe, expect, test } from "vitest";
import { historicalReservationCloseoutEvidence as evidence } from "./historicalReservationCloseoutEvidence";

describe("historical reservation closeout evidence", () => {
	test("pins historical order and reservation evidence without retaining capability evidence", () => {
		expect(Object.isFrozen(evidence)).toBe(true);
		expect(evidence.orderConfirmationClaimedAt).toBe(1_785_767_844_350);
		expect(evidence.boundReconcileAt - evidence.closeoutDeadline).toBe(8 * 60 * 60 * 1000);
		expect(evidence.closeoutDeadline).toBeLessThan(evidence.boundReconcileAt);
		expect(evidence).not.toHaveProperty("handleHash");
	});
});
