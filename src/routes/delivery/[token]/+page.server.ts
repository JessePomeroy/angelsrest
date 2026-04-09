import { error } from "@sveltejs/kit";
import { api } from "$convex/api";
import { getConvex } from "$lib/server/convexClient";

const convex = getConvex();
const WORKER_URL = "https://gallery-worker.thinkingofview.workers.dev";

export async function load({ params }) {
	const { token } = params;

	const result = await convex.query(api.portal.getByToken, { token });

	if (!result) {
		throw error(404, "This gallery link is not valid.");
	}

	if (result.expired) {
		throw error(410, "This gallery link has expired.");
	}

	if (result.token.type !== "gallery") {
		throw error(404, "Invalid gallery link.");
	}

	const gallery = result.document as {
		_id: string;
		name: string;
		slug: string;
		status: string;
		imageCount: number;
		downloadEnabled: boolean;
		favoritesEnabled: boolean;
		password?: string;
		coverImageKey?: string;
	};

	if (!gallery || gallery.status !== "published") {
		throw error(404, "This gallery is not available.");
	}

	const images = await convex.query(api.galleries.getImages, {
		galleryId: gallery._id as any,
	});

	return {
		token,
		gallery,
		images: images.map((img: any) => ({
			...img,
			thumbUrl: `${WORKER_URL}/image/${img.r2Key.replace("/original/", "/thumb/")}`,
			previewUrl: `${WORKER_URL}/image/${img.r2Key.replace("/original/", "/preview/")}`,
			downloadUrl: `${WORKER_URL}/download/${img.r2Key}?token=${token}`,
		})),
		client: result.client,
		workerUrl: WORKER_URL,
	};
}
