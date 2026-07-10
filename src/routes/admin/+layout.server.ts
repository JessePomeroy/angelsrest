import { getTenantAdminLayoutData, type TenantAdminLayoutData } from "@jessepomeroy/admin";
import { requireAuthWithIdentity } from "$lib/server/adminAuth";

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
	let identity: { email: string | null } | null = null;
	try {
		({ identity } = await requireAuthWithIdentity(cookies));
	} catch {
		return getTenantAdminLayoutData({ status: "unauthenticated" });
	}

	// angelsrest is the creator's site — always full tier
	// when extracted to the admin package, client sites will query Convex:
	//   const { tier } = await convex.query(api.platform.checkTier, { siteUrl })
	return getTenantAdminLayoutData({
		status: "authorized",
		email: identity.email,
		tier: "full",
		isCreator: true,
	});
}
