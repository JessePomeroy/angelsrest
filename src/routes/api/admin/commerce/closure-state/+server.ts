import { error, json } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import { parseCheckoutCatalogProvider } from "$lib/server/checkoutCommerce";
import { newOrderCheckoutDecision } from "$lib/server/commercePurposeControls";
import { checkoutSnapshotMode } from "$lib/server/handleCheckout";
import { normalizeOrderProducersState } from "$lib/server/orderProducerGate";
import { verifySiteAdminRequest } from "$lib/server/siteAdminAuthorization";

export async function GET({ request }: { request: Request }) {
	if (!(await verifySiteAdminRequest(request))) throw error(401, "Unauthorized");
	const checkout = newOrderCheckoutDecision("angelsrest.online");
	return json({
		version: 1,
		emergencyOrderQuiescence: normalizeOrderProducersState(env.ORDER_PRODUCERS_STATE),
		newOrderCheckout: {
			state: checkout.state,
			generation: checkout.generation,
			configuration: checkout.valid ? "exact" : "invalid",
		},
		checkoutSnapshotMode: checkoutSnapshotMode(env.CHECKOUT_SNAPSHOT_MODE),
		checkoutCatalogProvider: parseCheckoutCatalogProvider(env.CHECKOUT_CATALOG_PROVIDER),
	});
}
