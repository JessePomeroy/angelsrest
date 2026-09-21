import { error, fail, isHttpError, redirect } from "@sveltejs/kit";
import { api } from "$convex/api";
import { requireAuth, requireAuthWithIdentity } from "$lib/server/adminAuth";
import { createAuthenticatedConvexClient } from "$lib/server/convexClient";
import { getPublicSiteOrigin } from "$lib/server/runtimeConfig";
import { getStripe } from "$lib/server/stripeClient";
import {
	assertStripeConnectOnboardingEnabled,
	assertStripeConnectRequestOrigin,
	isStripeConnectOnboardingEnabled,
} from "$lib/server/stripeConnectGate";
import {
	createStripeConnectOnboardingSession,
	normalizeStripeConnectError,
	normalizeStripeConnectSiteUrl,
	readStripeConnectStatus,
} from "$lib/server/stripeConnectOnboarding";
import { createStripeConnectStore } from "$lib/server/stripeConnectStore";
import type { StripeConnectSetupData } from "$lib/stripeConnectSetup";
import type { Actions, PageServerLoad } from "./$types";

function requireSite(value: string) {
	const site = normalizeStripeConnectSiteUrl(value);
	if (!site) throw error(400, "A valid client website is required");
	return site;
}

export const load: PageServerLoad = async ({
	params,
	cookies,
	url,
}): Promise<StripeConnectSetupData> => {
	const siteUrl = requireSite(params.siteUrl);
	const data: StripeConnectSetupData = {
		siteUrl,
		onboardingEnabled: isStripeConnectOnboardingEnabled(),
		sessionStatus: "signed_out",
		email: null,
		accountId: null,
		readiness: null,
		message: null,
		returned: url.searchParams.get("returned") === "1",
	};
	let session: Awaited<ReturnType<typeof requireAuthWithIdentity>>;
	try {
		session = await requireAuthWithIdentity(cookies);
	} catch (cause) {
		if (isHttpError(cause, 401)) return data;
		return {
			...data,
			sessionStatus: "unavailable",
			message: "We could not check your login. Please try again.",
		};
	}
	data.email = session.identity.email;
	const convex = createAuthenticatedConvexClient(session.token);
	try {
		// Existing invited admins claim their stable identity as in the admin shell.
		// A creator assisting a client may not be on that site's invitation list;
		// the following target query independently checks creator/site membership.
		await convex.mutation(api.adminAuth.claimAdminAccess, { siteUrl }).catch(() => undefined);
		const store = createStripeConnectStore(convex);
		const target = await store.findClient(siteUrl);
		data.siteUrl = target.siteUrl;
		data.accountId = target.stripeConnectedAccountId;
		if (!data.onboardingEnabled) return { ...data, sessionStatus: "authorized" };
		const connection = await readStripeConnectStatus({ siteUrl, stripe: getStripe(), store });
		return { ...data, ...connection, sessionStatus: "authorized" };
	} catch (cause) {
		const normalized = normalizeStripeConnectError(cause);
		if (normalized?.status === 403)
			return { ...data, sessionStatus: "unauthorized", message: normalized.message };
		return {
			...data,
			sessionStatus: "unavailable",
			message:
				"We could not verify this payment connection. Please try again or contact Angels Rest.",
		};
	}
};

export const actions: Actions = {
	start: async ({ params, cookies, request }) => {
		const siteUrl = requireSite(params.siteUrl);
		let result: Awaited<ReturnType<typeof createStripeConnectOnboardingSession>>;
		try {
			const token = await requireAuth(cookies);
			assertStripeConnectRequestOrigin(request);
			assertStripeConnectOnboardingEnabled();
			result = await createStripeConnectOnboardingSession({
				siteUrl,
				platformOrigin: getPublicSiteOrigin(),
				stripe: getStripe(),
				store: createStripeConnectStore(createAuthenticatedConvexClient(token)),
			});
		} catch (cause) {
			if (isHttpError(cause, 401))
				return fail(401, { message: "Your session expired. Sign in again to continue." });
			const normalized = normalizeStripeConnectError(cause);
			return fail(normalized?.status ?? 503, {
				message:
					normalized?.message ?? "Payment setup is temporarily unavailable. Please try again.",
			});
		}
		throw redirect(303, result.url);
	},
};
