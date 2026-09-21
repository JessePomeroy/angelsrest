import { type Infer, v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { isTenantId, resolveTenantContext } from "./tenantContext";

export const lumaprintsConnectionFields = {
	version: v.literal(1),
	connectionRef: v.string(),
	tenantId: v.string(),
	storeId: v.number(),
	environment: v.union(v.literal("sandbox"), v.literal("production")),
};
export const lumaprintsConnectionValidator = v.object(lumaprintsConnectionFields);
export type LumaPrintsConnection = Infer<typeof lumaprintsConnectionValidator>;

export function sameLumaPrintsConnection(left?: LumaPrintsConnection, right?: LumaPrintsConnection) {
	if (!left || !right) return left === right;
	return left.version === right.version && left.connectionRef === right.connectionRef
		&& left.tenantId === right.tenantId && left.storeId === right.storeId
		&& left.environment === right.environment;
}

/** Accepted work uses immutable ownership, independent of the current selection. */
export async function assertSavedLumaPrintsConnection(
	ctx: Pick<QueryCtx, "db">, connection: LumaPrintsConnection, tenantId: string | undefined,
) {
	if (connection.tenantId !== tenantId) throw new Error("LumaPrints connection tenant does not match order");
	const saved = await resolveLumaPrintsConnection(ctx, connection.connectionRef);
	if (!saved || !sameLumaPrintsConnection(connection, saved.context)) {
		throw new Error("LumaPrints connection does not match saved ownership");
	}
}

/** New print reservations capture the selected supplier in the same transaction as artwork. */
export async function captureCurrentLumaPrintsConnection(
	ctx: Pick<QueryCtx, "db">, tenantId: string,
) {
	const tenant = await resolveTenantContext(ctx, { tenantId });
	if (!tenant || tenant.client.role === "creator" || tenant.client.siteUrl === "angelsrest.online") {
		throw new Error("Client supplier identity is unavailable");
	}
	const reference = tenant.client.lumaprintsConnectionRef;
	if (!reference) throw new Error("Client supplier connection is required");
	const saved = await resolveLumaPrintsConnection(ctx, reference);
	if (!saved || saved.owner._id !== tenant.client._id || saved.context.tenantId !== tenantId) {
		throw new Error("Client supplier connection is inconsistent");
	}
	return saved.context;
}

export function assertLumaPrintsConnection(value: LumaPrintsConnection) {
	if (!/^lp_[A-Za-z0-9_-]{8,80}$/.test(value.connectionRef)
		|| !isTenantId(value.tenantId)
		|| !Number.isSafeInteger(value.storeId) || value.storeId <= 0) {
		throw new Error("Invalid LumaPrints connection identity");
	}
}

/** Only non-secret, immutable routing facts may accompany accepted work. */
export function lumaprintsConnectionContext(connection: Doc<"lumaprintsConnections">): LumaPrintsConnection {
	const { version, connectionRef, tenantId, storeId, environment } = connection;
	const context = { version, connectionRef, tenantId, storeId, environment };
	assertLumaPrintsConnection(context);
	return context;
}

/** Historical ownership survives detachment; current selection is checked by the caller. */
export async function resolveLumaPrintsConnection(ctx: Pick<QueryCtx, "db">, connectionRef: string) {
	if (!/^lp_[A-Za-z0-9_-]{8,80}$/.test(connectionRef)) throw new Error("Invalid LumaPrints connection reference");
	const connection = await ctx.db.query("lumaprintsConnections")
		.withIndex("by_connectionRef", q => q.eq("connectionRef", connectionRef)).unique();
	const selections = await ctx.db.query("platformClients")
		.withIndex("by_lumaprintsConnectionRef", q => q.eq("lumaprintsConnectionRef", connectionRef)).take(2);
	if (!connection) {
		if (selections.length) throw new Error("LumaPrints connection ownership is missing");
		return null;
	}
	const context = lumaprintsConnectionContext(connection);
	const owner = await ctx.db.get(connection.clientId);
	const tenantOwner = await ctx.db.query("platformClients")
		.withIndex("by_tenantId", q => q.eq("tenantId", context.tenantId)).unique();
	if (!owner || owner.tenantId !== connection.tenantId || tenantOwner?._id !== owner._id
		|| selections.length > 1 || selections.some(client => client._id !== connection.clientId)) {
		throw new Error("LumaPrints connection ownership is inconsistent");
	}
	return { connection, context, owner };
}
