import { json } from "@sveltejs/kit";

export async function POST({ request }: { request: Request }) {
	const { r2Key } = await request.json();
	// R2 cleanup is deferred — images will be cleaned up by a future job
	return json({ success: true, r2Key });
}
