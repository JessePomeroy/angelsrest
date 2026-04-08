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
			"https://acoustic-kiwi-347.convex.site",
			"https://loyal-swan-967.convex.site",
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
		plugins: [convex({ authConfig })],
	});
};
