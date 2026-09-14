import { publicAssets } from "$lib/config/publicAssets";

export function GET() {
	return new Response(null, {
		status: 307,
		headers: {
			Location: publicAssets.openGraph,
			"Cache-Control": "public, max-age=300",
		},
	});
}
