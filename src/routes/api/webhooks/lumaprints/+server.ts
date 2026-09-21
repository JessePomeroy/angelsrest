import { handleLumaPrintsWebhook } from "$lib/server/lumaprintsWebhookIntake.server";
import type { RequestEvent } from "./$types";

export function POST({ request }: Pick<RequestEvent, "request">) {
	return handleLumaPrintsWebhook(request);
}
