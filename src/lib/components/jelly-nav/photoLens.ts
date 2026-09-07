import type { Point } from "./motion";

// Draw only the loaded, explicitly marked photograph beneath the sphere.
// No page capture, pixel reads, network fetches, or exported canvas data.
export function drawPhotoLens(canvas: HTMLCanvasElement, point: Point): boolean {
	const target = document
		.elementsFromPoint(point.x, point.y)
		.find((element) => !element.closest(".jelly-nav"));
	if (
		!(target instanceof HTMLImageElement) ||
		!target.hasAttribute("data-water-lens") ||
		!target.complete ||
		!target.naturalWidth
	)
		return false;
	const context = canvas.getContext("2d");
	if (!context) return false;
	const rect = target.getBoundingClientRect();
	const style = getComputedStyle(target);
	// Marked photographs use centered object positioning. Skip unusual crops
	// instead of showing a different part of the image through the lens.
	if (style.objectPosition !== "50% 50%" || rect.width <= 0 || rect.height <= 0) return false;
	let width = rect.width;
	let height = rect.height;
	if (style.objectFit !== "fill") {
		let scale = Math.min(rect.width / target.naturalWidth, rect.height / target.naturalHeight);
		if (style.objectFit === "cover")
			scale = Math.max(rect.width / target.naturalWidth, rect.height / target.naturalHeight);
		if (style.objectFit === "none") scale = 1;
		if (style.objectFit === "scale-down") scale = Math.min(scale, 1);
		width = target.naturalWidth * scale;
		height = target.naturalHeight * scale;
	}
	const left = rect.left + (rect.width - width) / 2;
	const top = rect.top + (rect.height - height) / 2;
	if (point.x < left || point.x > left + width || point.y < top || point.y > top + height)
		return false;
	const zoom = 1.16;
	const size = 80;
	context.clearRect(0, 0, canvas.width, canvas.height);
	context.save();
	context.scale(canvas.width / size, canvas.height / size);
	context.beginPath();
	context.arc(40, 40, 36, 0, Math.PI * 2);
	context.clip();
	context.translate(40, 40);
	context.scale(zoom, zoom);
	try {
		context.drawImage(target, left - point.x, top - point.y, width, height);
	} catch {
		context.restore();
		return false;
	}
	context.restore();
	return true;
}
