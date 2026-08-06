import type { RequestHandler } from "./$types";

/** Compatibility tombstone for the retired anonymous provider relay. */
export const POST: RequestHandler = () => new Response(null, { status: 410 });
