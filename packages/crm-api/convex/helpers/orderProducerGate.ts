export const ORDER_PRODUCERS_STATE_NAME = "ORDER_PRODUCERS_STATE";
export const ORDER_PRODUCERS_CLOSED_MESSAGE = "Order producers are closed";

export type OrderProducersState = "closed" | "open";

export function normalizeOrderProducersState(value: unknown): OrderProducersState {
	return value === "open" ? "open" : "closed";
}

export function assertOrderProducersOpen() {
	if (normalizeOrderProducersState(process.env.ORDER_PRODUCERS_STATE) !== "open") {
		throw new Error(ORDER_PRODUCERS_CLOSED_MESSAGE);
	}
}

/** Require an explicit closed state for destructive maintenance. */
export function assertOrderProducersExactlyClosed() {
	if (process.env.ORDER_PRODUCERS_STATE !== "closed") {
		throw new Error("Order producers must be explicitly closed");
	}
}
