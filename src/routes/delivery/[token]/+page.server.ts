import { resolveGalleryDisplayImages } from "@jessepomeroy/gallery-delivery/display-images";
import { galleryOriginalDownloadUrl } from "@jessepomeroy/gallery-delivery/download-urls";
import { error, fail, redirect } from "@sveltejs/kit";
import { dev } from "$app/environment";
import { api } from "$convex/api";
import type { Id } from "$convex/dataModel";
import { getConvex } from "$lib/server/convexClient";
import { getGalleryWorkerUrl } from "$lib/server/galleryWorkerUrl";
import type { Actions } from "./$types";

const convex = getConvex();
const ACCESS_COOKIE = "gallery_access";

function accessCookiePath(token: string) {
	return `/delivery/${token}`;
}

export const actions: Actions = {
	unlock: async ({ request, params, cookies }) => {
		const token = params.token;
		const password = (await request.formData()).get("password");
		if (!token || typeof password !== "string" || !password) {
			return fail(400, { message: "Enter the gallery password." });
		}

		try {
			const grant = await convex.action(api.galleryPassword.verifyPassword, { token, password });
			cookies.set(ACCESS_COOKIE, grant.accessGrant, {
				path: accessCookiePath(token),
				httpOnly: true,
				sameSite: "strict",
				secure: !dev,
				maxAge: Math.max(1, Math.floor((grant.expiresAt - Date.now()) / 1000)),
			});
		} catch (cause) {
			const message =
				cause instanceof Error && cause.message.includes("Too many attempts")
					? "Too many attempts. Please wait 15 minutes and try again."
					: "That password is not correct.";
			return fail(401, { message });
		}
		throw redirect(303, accessCookiePath(token));
	},
};

export async function load({ params, cookies }) {
	const { token } = params;
	const accessGrant = cookies.get(ACCESS_COOKIE) || undefined;

	const result = await convex.query(api.portal.getByToken, { token, accessGrant });

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
		_id: Id<"galleries">;
		name: string;
		slug: string;
		status: string;
		imageCount: number;
		downloadEnabled: boolean;
		favoritesEnabled: boolean;
		passwordProtected: boolean;
		coverImageKey?: string;
	};

	if (!gallery || gallery.status !== "published") {
		throw error(404, "This gallery is not available.");
	}
	if (result.requiresPassword) {
		if (accessGrant) cookies.delete(ACCESS_COOKIE, { path: accessCookiePath(token) });
		return {
			token,
			accessGrant: "",
			requiresPassword: true,
			gallery,
			images: [],
			client: result.client,
			workerUrl: getGalleryWorkerUrl(),
		};
	}

	const images = await convex.query(api.galleries.getImages, {
		galleryId: gallery._id,
		token,
		accessGrant,
	});

	const workerUrl = getGalleryWorkerUrl();

	return {
		token,
		gallery,
		images: resolveGalleryDisplayImages(
			images.map((img) => ({
				...img,
				downloadUrl: gallery.downloadEnabled
					? galleryOriginalDownloadUrl(workerUrl, img.r2Key, token, accessGrant)
					: null,
			})),
			workerUrl,
			{ token, accessGrant },
		),
		client: result.client,
		workerUrl,
		accessGrant: accessGrant ?? "",
		requiresPassword: false,
	};
}
