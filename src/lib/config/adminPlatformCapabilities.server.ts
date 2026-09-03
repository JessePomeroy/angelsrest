import type { AdminAPI } from "@jessepomeroy/admin";
import type * as generatedApiModule from "$convex/api";
import {
	type AdminBrowserCapabilities,
	createAdminBrowserCapabilities,
} from "./adminPlatformCapabilities";

type GeneratedApi = typeof generatedApiModule.api;

export type AdminServerCapabilities = Omit<AdminBrowserCapabilities, "documentEmailAttempts"> & {
	readonly documentEmailAttempts: NonNullable<AdminAPI["documentEmailAttempts"]>;
};

/** Extend the browser-safe facade with capabilities used only by server handlers. */
export function createAdminServerCapabilities(api: GeneratedApi): AdminServerCapabilities {
	return {
		...createAdminBrowserCapabilities(api),
		documentEmailAttempts: {
			get: api.documentEmailAttempts.get,
			getRecovery: api.documentEmailAttempts.getRecovery,
			getOpenRecoveryByDocument: api.documentEmailAttempts.getOpenRecoveryByDocument,
			prepare: api.documentEmailAttempts.prepare,
			claim: api.documentEmailAttempts.claim,
			complete: api.documentEmailAttempts.complete,
			fail: api.documentEmailAttempts.fail,
			resolve: api.documentEmailAttempts.resolve,
		},
	};
}
