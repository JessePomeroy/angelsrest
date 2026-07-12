function galleryAccessQuery(token: string, accessGrant?: string) {
	const params = new URLSearchParams({ token });
	if (accessGrant) params.set("accessGrant", accessGrant);
	return params.toString();
}

export function galleryOriginalDownloadUrl(
	workerUrl: string,
	r2Key: string,
	token: string,
	accessGrant?: string,
) {
	return `${workerUrl.replace(/\/$/, "")}/download/${encodeURIComponent(r2Key)}?${galleryAccessQuery(token, accessGrant)}`;
}

export function galleryZipDownloadUrl(workerUrl: string) {
	return `${workerUrl.replace(/\/$/, "")}/download/zip`;
}

export function galleryPrepareZipDownloadUrl(workerUrl: string) {
	return `${workerUrl.replace(/\/$/, "")}/download/zip/prepare`;
}

export function galleryPreparedZipStatusUrl(
	workerUrl: string,
	requestId: string,
	token: string,
	accessGrant?: string,
) {
	return `${workerUrl.replace(/\/$/, "")}/download/zip/prepare/${encodeURIComponent(requestId)}?${galleryAccessQuery(token, accessGrant)}`;
}

export function galleryPreparedZipCancelUrl(
	workerUrl: string,
	requestId: string,
	token: string,
	accessGrant?: string,
) {
	return `${workerUrl.replace(/\/$/, "")}/download/zip/prepare/${encodeURIComponent(requestId)}/cancel?${galleryAccessQuery(token, accessGrant)}`;
}

export function galleryPreparedZipArchiveUrl(
	workerUrl: string,
	archiveDownloadPath: string,
	token: string,
	accessGrant?: string,
) {
	return `${workerUrl.replace(/\/$/, "")}${archiveDownloadPath}?${galleryAccessQuery(token, accessGrant)}`;
}
