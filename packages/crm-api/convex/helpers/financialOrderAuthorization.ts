import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { isSiteAdminIdentity, requireAuth, requireDocumentSiteAdmin } from "../authHelpers";
import { validApplicationFeeContext } from "./applicationFeeVerification";
import { resolveTenantContext } from "./tenantContext";

/** Financial records belong to their original tenant even after a domain/account change. */
export async function requireFinancialOrderAdmin(ctx: QueryCtx | MutationCtx, orderId: Id<"orders">) {
	const identity = await requireAuth(ctx);
	const order = await ctx.db.get(orderId);
	if (!order) throw new Error("Not found");
	const saved = order.checkoutFinancialSnapshot;
	if (!saved) return await requireDocumentSiteAdmin(ctx, "orders", orderId);
	if (!validApplicationFeeContext(order)) throw new Error("Invalid original financial context");
	const owner = await resolveTenantContext(ctx, { tenantId: saved.tenantId });
	if (!owner || !isSiteAdminIdentity(identity, owner.client)) {
		throw new Error("Not authorized (not an original tenant admin)");
	}
	return order;
}
