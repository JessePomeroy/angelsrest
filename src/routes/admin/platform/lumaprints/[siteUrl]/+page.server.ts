import { error, fail, isHttpError } from "@sveltejs/kit";
import { requireAuth } from "$lib/server/adminAuth";
import { createAuthenticatedConvexClient } from "$lib/server/convexClient";
import {
	emptyLumaPrintsSetupData,
	isLumaPrintsSetupEnabled,
	loadLumaPrintsSetup,
	normalizeLumaPrintsSetupError,
	readLumaPrintsSetupForm,
	requireLumaPrintsSetupSite,
	verifyAndRegisterLumaPrintsConnection,
} from "$lib/server/lumaprintsSetup.server";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ parent, params, cookies, setHeaders }) => {
	setHeaders({
		"cache-control": "private, no-store",
		"referrer-policy": "no-referrer",
		"x-robots-tag": "noindex, nofollow",
	});
	const { adminSession } = await parent();
	let siteUrl: string;
	try {
		siteUrl = requireLumaPrintsSetupSite(params.siteUrl);
	} catch {
		throw error(400, "Choose a valid client website.");
	}
	if (adminSession.status !== "authorized")
		return { supplierSetup: emptyLumaPrintsSetupData(siteUrl, "unauthorized") };
	if (!isLumaPrintsSetupEnabled())
		return { supplierSetup: emptyLumaPrintsSetupData(siteUrl, "disabled") };
	try {
		const token = await requireAuth(cookies);
		return {
			supplierSetup: await loadLumaPrintsSetup(createAuthenticatedConvexClient(token), siteUrl),
		};
	} catch (cause) {
		const status =
			isHttpError(cause, 401) || normalizeLumaPrintsSetupError(cause).status === 403
				? "unauthorized"
				: "unavailable";
		return { supplierSetup: emptyLumaPrintsSetupData(siteUrl, status) };
	}
};

export const actions: Actions = {
	connect: async ({ params, cookies, request }) => {
		try {
			const token = await requireAuth(cookies);
			const input = await readLumaPrintsSetupForm(request);
			await verifyAndRegisterLumaPrintsConnection(createAuthenticatedConvexClient(token), {
				siteUrl: params.siteUrl,
				...input,
			});
			return { saved: true };
		} catch (cause) {
			if (isHttpError(cause, 401))
				return fail(401, { message: "Your session expired. Sign in again before connecting." });
			const problem = normalizeLumaPrintsSetupError(cause);
			return fail(problem.status, { message: problem.message });
		}
	},
};
