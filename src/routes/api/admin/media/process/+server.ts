import { createCmsMediaProcessHandler } from "@jessepomeroy/admin/server";
import type { Config } from "@sveltejs/adapter-vercel";
import type { RequestHandler } from "./$types";
import "$lib/server/adminHandler";

const handler = createCmsMediaProcessHandler();

export const config = { maxDuration: 300 } satisfies Config;

export const POST: RequestHandler = handler;
