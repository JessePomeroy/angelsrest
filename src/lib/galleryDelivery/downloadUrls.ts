export function galleryOriginalDownloadUrl(workerUrl: string, r2Key: string, token: string) {
	return `${workerUrl.replace(/\/$/, "")}/download/${encodeURIComponent(r2Key)}?token=${encodeURIComponent(token)}`;
}

export function galleryZipDownloadUrl(workerUrl: string) {
	return `${workerUrl.replace(/\/$/, "")}/download/zip`;
}

export function galleryPrepareZipDownloadUrl(workerUrl: string) {
	return `${workerUrl.replace(/\/$/, "")}/download/zip/prepare`;
}

export function galleryPreparedZipStatusUrl(workerUrl: string, requestId: string, token: string) {
	return `${workerUrl.replace(/\/$/, "")}/download/zip/prepare/${encodeURIComponent(requestId)}?token=${encodeURIComponent(token)}`;
}

export function galleryPreparedZipArchiveUrl(
	workerUrl: string,
	archiveDownloadPath: string,
	token: string,
) {
	return `${workerUrl.replace(/\/$/, "")}${archiveDownloadPath}?token=${encodeURIComponent(token)}`;
}
