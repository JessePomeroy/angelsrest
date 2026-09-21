import { env } from "$env/dynamic/private";
import { StripeConnectOnboardingError } from "$lib/server/stripeConnectOnboarding";

export function isStripeConnectOnboardingEnabled() {
	return env.STRIPE_CONNECT_ONBOARDING_ENABLED === "true";
}

export function assertStripeConnectOnboardingEnabled() {
	if (!isStripeConnectOnboardingEnabled()) {
		throw new StripeConnectOnboardingError(
			503,
			"Angels Rest is preparing payment setup. Please try again later.",
		);
	}
}

export function assertStripeConnectRequestOrigin(request: Request) {
	if (request.headers.get("origin") !== new URL(request.url).origin) {
		throw new StripeConnectOnboardingError(403, "Open payment setup on this website to continue.");
	}
}
