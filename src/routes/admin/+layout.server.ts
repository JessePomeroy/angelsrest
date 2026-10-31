import { getTenantAdminLayoutData, type TenantAdminLayoutData } from "@jessepomeroy/admin/core";
import { env } from "$env/dynamic/private";
import { requireAuthWithIdentity } from "$lib/server/adminAuth";
import { getSiteAdminAccess } from "$lib/server/siteAdminAuthorization";

type HostAdminLayoutData = TenantAdminLayoutData & { galleryWorkerUrl?: string };

function layoutData(session: Parameters<typeof getTenantAdminLayoutData>[0]): HostAdminLayoutData {
	return {
		...getTenantAdminLayoutData(session),
		// Browser uploads must use the same nonsecret endpoint as server handlers.
		galleryWorkerUrl: env.GALLERY_WORKER_URL,
	};
}

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
export async function load({ cookies }): Promise<HostAdminLayoutData> {
	let session: Awaited<ReturnType<typeof requireAuthWithIdentity>>;
	try {
		session = await requireAuthWithIdentity(cookies);
	} catch {
		return layoutData({ status: "unauthenticated" });
	}

	if (!session.identity.email) {
		return layoutData({ status: "unauthenticated" });
	}

	const access = await getSiteAdminAccess(session.token, session.identity.email);
	if (!access?.authorized || !("enabledFeatures" in access)) {
		return layoutData({
			status: "unauthorized",
			email: session.identity.email,
		});
	}

	return layoutData({
		status: "authorized",
		email: session.identity.email,
		tier: access.tier,
		enabledFeatures: access.enabledFeatures,
		isCreator: true,
	});
}
