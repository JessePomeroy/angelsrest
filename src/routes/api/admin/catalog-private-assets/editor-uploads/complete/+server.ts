import { createCatalogPrivateEditorUploadCompleteHandler } from "@jessepomeroy/admin/server";
import type { Config } from "@sveltejs/adapter-vercel";
import type { RequestHandler } from "./$types";
import "$lib/server/adminHandler";

export const config = {
	runtime: "nodejs24.x",
	maxDuration: 60,
} satisfies Config;

export const POST: RequestHandler = createCatalogPrivateEditorUploadCompleteHandler();
