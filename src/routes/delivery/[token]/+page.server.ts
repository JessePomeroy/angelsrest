import { error } from "@sveltejs/kit";
import { api } from "$convex/api";
import { getConvex } from "$lib/server/convexClient";
import { getGalleryWorkerUrl } from "$lib/server/galleryWorkerUrl";

const convex = getConvex();

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

	const workerUrl = getGalleryWorkerUrl();

	return {
		token,
		gallery,
		images: images.map((img: any) => ({
			...img,
			thumbUrl: `${workerUrl}/image/${img.r2Key.replace("/original/", "/thumb/")}`,
			previewUrl: `${workerUrl}/image/${img.r2Key.replace("/original/", "/preview/")}`,
			downloadUrl: `${workerUrl}/download/${img.r2Key}?token=${token}`,
		})),
		client: result.client,
		workerUrl,
	};
}
