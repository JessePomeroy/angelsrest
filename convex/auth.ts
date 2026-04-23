import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { betterAuth } from "better-auth/minimal";
import { components } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import authConfig from "./auth.config";

export const authComponent = createClient<DataModel>(components.betterAuth);

export const createAuth = (ctx: GenericCtx<DataModel>) => {
	const siteUrl = process.env.SITE_URL!;
	return betterAuth({
		baseURL: siteUrl,
		secret: process.env.BETTER_AUTH_SECRET!,
		trustedOrigins: [
			siteUrl,
			"http://localhost:5173",
			"https://angelsrest.online",
			"https://www.angelsrest.online",
		],
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
