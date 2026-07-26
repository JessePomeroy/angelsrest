export interface CheckoutAttempt {
	attempt: string;
	attemptStartedAt: number;
}

export class CheckoutAttemptTracker {
	#current: (CheckoutAttempt & { intent: string }) | null = null;

	constructor(
		private readonly randomUUID = () => crypto.randomUUID(),
		private readonly now = () => Date.now(),
	) {}

	forIntent(intent: unknown): CheckoutAttempt {
		const serialized = JSON.stringify(intent);
		if (!this.#current || this.#current.intent !== serialized) {
			this.#current = {
				intent: serialized,
				attempt: this.randomUUID(),
				attemptStartedAt: this.now(),
			};
		}
		return {
			attempt: this.#current.attempt,
			attemptStartedAt: this.#current.attemptStartedAt,
		};
	}

	confirm(attempt: string) {
		if (this.#current?.attempt === attempt) this.#current = null;
	}
}

export function checkoutTenantIntent() {
	return typeof location === "undefined" ? "same-origin" : location.origin;
}
