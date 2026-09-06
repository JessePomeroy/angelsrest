// Synthetic, separate authorities. These values never authenticate a network request.
export const tenant = "angelsrest.online";
export const origin = "https://cms-media-worker.thinkingofview.workers.dev";
export const uploadSecret = "fixture-artifact-uploader-0123456789+/==";
export const issuerSecret = "fixture-print-issuer-0123456789+/==";
export const adminSecret = "fixture-editor-authority-0123456789abcdef";
export const env = {
	PUBLIC_SITE_URL: `https://${tenant}`,
	CATALOG_FULFILLMENT_WORKER_ORIGIN: origin,
	CATALOG_PRINT_ARTIFACT_UPLOAD_SECRET: uploadSecret,
	CATALOG_PRINT_SOURCE_ISSUER_SECRET: issuerSecret,
	CMS_MEDIA_WORKER_SECRET: adminSecret,
};
