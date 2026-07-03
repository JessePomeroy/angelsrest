export function galleryOriginalDownloadUrl(workerUrl: string, r2Key: string, token: string) {
	return `${workerUrl.replace(/\/$/, "")}/download/${encodeURIComponent(r2Key)}?token=${encodeURIComponent(token)}`;
}

export function galleryZipDownloadUrl(workerUrl: string) {
	return `${workerUrl.replace(/\/$/, "")}/download/zip`;
}
