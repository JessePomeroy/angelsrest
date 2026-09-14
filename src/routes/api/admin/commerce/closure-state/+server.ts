import { error, json } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import { newOrderCheckoutDecision } from "$lib/server/commercePurposeControls";
import { checkoutSnapshotMode } from "$lib/server/handleCheckout";
import { normalizeOrderProducersState } from "$lib/server/orderProducerGate";
import { authorizeR4ReadRequest, r4ReadPurposes } from "$lib/server/r4ReadAuthorization";

export async function GET({ request }: { request: Request }) {
	if (!(await authorizeR4ReadRequest(request, r4ReadPurposes.closureState))) {
		throw error(401, "Unauthorized");
	}
	const checkout = newOrderCheckoutDecision("angelsrest.online");
	return json(
		{
			version: 2,
			emergencyOrderQuiescence: normalizeOrderProducersState(env.ORDER_PRODUCERS_STATE),
			newOrderCheckout: {
				state: checkout.state,
				generation: checkout.generation,
				configuration: checkout.valid ? "exact" : "invalid",
			},
			firstPartyCheckout: {
				catalogProvider: "convex",
				snapshotProtocol: "handle-v2",
			},
			compatibility: {
				tenantBridgeAndIntakeSnapshotMode: checkoutSnapshotMode(env.CHECKOUT_SNAPSHOT_MODE),
			},
		},
		{ headers: { "cache-control": "no-store" } },
	);
}
