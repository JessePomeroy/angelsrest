import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { betterAuth } from "better-auth/minimal";
import { components } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import authConfig from "./auth.config";

export const authComponent = createClient<DataModel>(components.betterAuth);

export const createAuth = (ctx: GenericCtx<DataModel>) => {
	const siteUrl = process.env.SITE_URL!;
	// Option A Phase 5 (2026-04-25): under per-client Convex deployments,
	// each deployment is single-tenant — `SITE_URL` is the only canonical
	// origin. The previous hardcoded angelsrest entries were a multi-tenant
	// holdover and would block sign-in on any new spoke. Derive the trusted
	// list from `SITE_URL`: the configured value, its apex variant (in case
	// the site canonicalizes on `www.`), and localhost for dev.
	// Deduped via Set since `siteUrl` and the apex variant collide when
	// SITE_URL has no `www.` prefix.
	const apexUrl = siteUrl.replace("https://www.", "https://");
	const trustedOrigins = Array.from(
		new Set([siteUrl, apexUrl, "http://localhost:5173"]),
	);
	return betterAuth({
		baseURL: siteUrl,
		secret: process.env.BETTER_AUTH_SECRET!,
		trustedOrigins,
		database: authComponent.adapter(ctx),
		emailAndPassword: { enabled: true },
		socialProviders: {
			google: {
				clientId: process.env.AUTH_GOOGLE_ID as string,
				clientSecret: process.env.AUTH_GOOGLE_SECRET as string,
			},
		},
		plugins: [
			convex({
				authConfig,
				// Auto-rotate JWKS keys if the JWT library hits
				// ERR_JOSE_NOT_SUPPORTED (alg mismatch between the stored key
				// and the current plugin config). Without this flag, sign-in
				// silently fails to set the `better-auth.convex_jwt` cookie
				// — the error is swallowed in the convex plugin's after-hook
				// try/catch, so the browser gets a valid session but no JWT,
				// breaking Convex WebSocket auth on the admin dashboard.
				jwksRotateOnTokenGenerationError: true,
			}),
		],
	});
};
