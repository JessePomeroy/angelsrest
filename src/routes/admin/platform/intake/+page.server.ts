import { error, fail, isHttpError } from "@sveltejs/kit";
import { api } from "$convex/api";
import type { Id } from "$convex/dataModel";
import {
	type IntakeRecoveryReason,
	type IntakeView,
	intakeRecoveryLabels,
	intakeStateLabels,
} from "$lib/commerceIntakeView";
import { SITE_DOMAIN } from "$lib/config/site";
import { requireAuth } from "$lib/server/adminAuth";
import { createAuthenticatedConvexClient } from "$lib/server/convexClient";
import type { Actions, PageServerLoad } from "./$types";

function site(value: unknown) {
	if (
		typeof value !== "string" ||
		!value ||
		value.length > 253 ||
		value !== value.trim() ||
		Array.from(value).some((character) => character.charCodeAt(0) < 32)
	) {
		throw error(400, "Choose a valid website.");
	}
	return value;
}
function state(value: string): IntakeView["state"] {
	if (value === "all" || Object.hasOwn(intakeStateLabels, value))
		return value as IntakeView["state"];
	throw error(400, "Choose a valid processing state.");
}

export const load: PageServerLoad = async ({ parent, cookies, url, setHeaders }) => {
	setHeaders({
		"cache-control": "private, no-store",
		"referrer-policy": "no-referrer",
		"x-robots-tag": "noindex, nofollow",
	});
	const { adminSession } = await parent();
	const siteUrl = site(url.searchParams.get("site") ?? SITE_DOMAIN);
	const selectedState = state(url.searchParams.get("state") ?? "blocked");
	const cursor = url.searchParams.get("cursor");
	if (cursor !== null && cursor.length > 4096)
		throw error(400, "Reload the first page of results.");
	const intake: IntakeView = {
		status: "unauthorized",
		siteUrl,
		state: selectedState,
		clients: [],
		rows: [],
		cursor,
		nextCursor: null,
		observedAt: Date.now(),
	};
	if (adminSession.status !== "authorized" || !adminSession.isCreator) return { intake };
	try {
		const convex = createAuthenticatedConvexClient(await requireAuth(cookies));
		const [clients, page] = await Promise.all([
			convex.query(api.platform.listAll, {}),
			convex.query(api.commerceIntakeInbox.list, {
				siteUrl,
				...(selectedState === "all" ? {} : { state: selectedState }),
				paginationOpts: { numItems: 25, cursor },
			}),
		]);
		return {
			intake: {
				...intake,
				status: "ready" as const,
				clients: clients.map(({ name, siteUrl }) => ({ name, siteUrl })),
				rows: page.page,
				nextCursor: page.isDone ? null : page.continueCursor,
			},
		};
	} catch {
		return { intake: { ...intake, status: "unavailable" as const } };
	}
};

export const actions: Actions = {
	recover: async ({ cookies, request }) => {
		try {
			const token = await requireAuth(cookies);
			const data = await request.formData();
			const siteUrl = site(data.get("siteUrl"));
			const inboxId = data.get("inboxId"),
				version = data.get("expectedVersion"),
				reason = data.get("reason");
			if (
				typeof inboxId !== "string" ||
				!/^[a-z0-9]{16,64}$/.test(inboxId) ||
				typeof version !== "string" ||
				!/^[1-9][0-9]{0,12}$/.test(version) ||
				typeof reason !== "string" ||
				!Object.hasOwn(intakeRecoveryLabels, reason)
			) {
				return fail(400, { message: "Reload the record and choose a recovery reason." });
			}
			// The authenticated backend independently requires stored creator membership,
			// exact website/version and safe persisted evidence before changing state.
			const result = await createAuthenticatedConvexClient(token).mutation(
				api.commerceIntakeInbox.recover,
				{
					inboxId: inboxId as Id<"commerceIntakeInbox">,
					siteUrl,
					expectedVersion: Number(version),
					reason: reason as IntakeRecoveryReason,
				},
			);
			return {
				message: result.changed
					? result.state === "done"
						? "Saved evidence confirms completion."
						: "Another processing attempt is scheduled."
					: "No change was made. Review the current state and saved evidence.",
			};
		} catch (cause) {
			if (isHttpError(cause, 401))
				return fail(401, { message: "Sign in again before requesting recovery." });
			return fail(409, {
				message:
					"Recovery was not applied. Reload the record, verify your access, and resolve the recorded issue before trying again.",
			});
		}
	},
};
