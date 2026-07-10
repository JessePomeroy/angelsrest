import { getTenantAdminLayoutData, type TenantAdminLayoutData } from "@jessepomeroy/admin";
import { requireAuthWithIdentity } from "$lib/server/adminAuth";
import { getSiteAdminAccess } from "$lib/server/siteAdminAuthorization";

/**
 * Server-side auth gate for /admin/**. Browser-side `<AuthGuard>` controls
 * rendering, while this loader independently validates the Better Auth
 * session before it reads or returns admin data.
 *
 * We don't redirect to a login URL — there isn't a dedicated /login route
 * in this app; the AuthGuard component renders `<LoginPage>` inline when
 * it sees no session. So on validation failure, we return an
 * `adminSession.status` of `unauthenticated`. The client-side AuthGuard
 * handles the login flow; child +page.server.ts loaders read the normalized
 * session state and skip their Convex fetches when it is not authorized.
 */
export async function load({ cookies }): Promise<TenantAdminLayoutData> {
	let session: Awaited<ReturnType<typeof requireAuthWithIdentity>>;
	try {
		session = await requireAuthWithIdentity(cookies);
	} catch {
		return getTenantAdminLayoutData({ status: "unauthenticated" });
	}

	if (!session.identity.email) {
		return getTenantAdminLayoutData({ status: "unauthenticated" });
	}

	const access = await getSiteAdminAccess(session.token, session.identity.email);
	if (!access?.authorized) {
		return getTenantAdminLayoutData({
			status: "unauthorized",
			email: session.identity.email,
		});
	}

	return getTenantAdminLayoutData({
		status: "authorized",
		email: session.identity.email,
		tier: access.tier,
		isCreator: true,
	});
}
