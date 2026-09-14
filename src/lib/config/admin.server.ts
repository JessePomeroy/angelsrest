import type { AdminServerConfig } from "@jessepomeroy/admin/server";
import { api } from "$convex/api";
import { adminAuth } from "$lib/server/adminAuth";
import { getGalleryWorkerUrl } from "$lib/server/galleryWorkerUrl";
import {
	getCatalogPrivateEditorUploadConfig,
	getCmsMediaConvexSiteOrigin,
	getCmsMediaDeletionCompletionSecret,
	getCmsMediaTenantSecret,
	getConvexUrl,
	getGalleryAdminSecret,
	getResendApiKey,
} from "$lib/server/runtimeConfig";
import { verifySiteAdminRequest } from "$lib/server/siteAdminAuthorization";
import { adminConfig } from "./admin";
import { createAdminServerCapabilities } from "./adminPlatformCapabilities.server";

export const adminServerConfig: AdminServerConfig = {
	...adminConfig,
	api: createAdminServerCapabilities(api),
	get galleryWorkerUrl() {
		return getGalleryWorkerUrl();
	},
	get galleryAdminSecret() {
		return getGalleryAdminSecret();
	},
	cmsMediaWorkerUrl: "https://cms-media-worker.thinkingofview.workers.dev",
	get cmsMediaTenantSecret() {
		return getCmsMediaTenantSecret();
	},
	get cmsMediaConvexSiteUrl() {
		return getCmsMediaConvexSiteOrigin();
	},
	get cmsMediaDeletionCompletionSecret() {
		return getCmsMediaDeletionCompletionSecret();
	},
	get catalogPrivateEditorUpload() {
		return getCatalogPrivateEditorUploadConfig();
	},
	get convexUrl() {
		return getConvexUrl();
	},
	get resendApiKey() {
		return getResendApiKey();
	},
	verifyAdmin: verifySiteAdminRequest,
	getConvexToken: adminAuth.getTokenFromRequest,
};
