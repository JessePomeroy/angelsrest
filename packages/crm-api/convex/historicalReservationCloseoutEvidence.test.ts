import { describe, expect, test } from "vitest";
import { historicalReservationCloseoutEvidence as evidence } from "./historicalReservationCloseoutEvidence";

describe("historical reservation closeout evidence", () => {
	test("pins an eight-hour closeout barrier without retaining capability evidence", () => {
		expect(Object.isFrozen(evidence)).toBe(true);
		expect(evidence.boundReconcileAt - evidence.closeoutDeadline).toBe(8 * 60 * 60 * 1000);
		expect(evidence.closeoutDeadline).toBeLessThan(evidence.boundReconcileAt);
		expect(evidence).not.toHaveProperty("handleHash");
	});
});
