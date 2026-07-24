import { createCatalogPrivateEditorUploadPrepareHandler } from "@jessepomeroy/admin/server";
import type { Config } from "@sveltejs/adapter-vercel";
import type { RequestHandler } from "./$types";
import "$lib/server/adminHandler";

export const config = {
	maxDuration: 30,
} satisfies Config;

export const POST: RequestHandler = createCatalogPrivateEditorUploadPrepareHandler();
