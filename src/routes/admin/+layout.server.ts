import { getTenantAdminLayoutData, type TenantAdminLayoutData } from "@jessepomeroy/admin";
import { requireAuthWithIdentity } from "$lib/server/adminAuth";

/**
 * Server-side auth gate for /admin/** (audit H4). The admin layout relied
 * entirely on the client-side `<AuthGuard>` before, which meant
 * `+layout.server.ts` handed out `tier` / `isCreator` / (in the page
 * loader) `newInquiryCount` to any unauthenticated caller that hit
 * `/admin`. Validating the session here kills that surface: the server
 * refuses to load admin data unless Convex confirms the Better Auth
 * session is intact.
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
		return getTenantAdminLayoutData(
			{ status: "unauthenticated" },
			{ tier: "full", isCreator: true },
		);
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
