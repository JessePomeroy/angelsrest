import { adminConfig as source } from "../../../src/lib/config/admin";
import { authClient } from "./auth";
export const adminConfig = {
	...source,
	siteUrl: "angelsrest.example",
	fromEmail: "Angels Rest Practice <operator@angelsrest.example>",
	galleryWorkerUrl: "https://worker.example",
	authClient,
	mutationTransport: "websocket" as const,
	api: { ...source.api, notifications: undefined },
};
