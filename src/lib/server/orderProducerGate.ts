import { env } from "$env/dynamic/private";

const ORDER_PRODUCERS_CLOSED_MESSAGE = "Order producers are closed";

export type OrderProducersState = "closed" | "open";

export class OrderProducersClosedError extends Error {
	constructor() {
		super(ORDER_PRODUCERS_CLOSED_MESSAGE);
		this.name = "OrderProducersClosedError";
	}
}

export function normalizeOrderProducersState(value: unknown): OrderProducersState {
	return value === "open" ? "open" : "closed";
}

export function assertOrderProducersOpen() {
	if (normalizeOrderProducersState(env.ORDER_PRODUCERS_STATE) !== "open") {
		throw new OrderProducersClosedError();
	}
}
