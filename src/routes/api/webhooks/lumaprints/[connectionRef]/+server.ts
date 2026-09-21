import { handleLumaPrintsWebhook } from "$lib/server/lumaprintsWebhookIntake.server";
import type { RequestEvent } from "./$types";

export function POST({ request, params }: Pick<RequestEvent, "request" | "params">) {
	return handleLumaPrintsWebhook(request, params.connectionRef);
}
