import { resolveGalleryDisplayImages } from "@jessepomeroy/gallery-delivery/display-images";
import { galleryOriginalDownloadUrl } from "@jessepomeroy/gallery-delivery/download-urls";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { onDestroy, tick, untrack } from "svelte";
import type { api } from "$convex/api";
import type { Id } from "$convex/dataModel";
import type { PageData } from "./$types";

type PageArgs = FunctionArgs<typeof api.galleries.getImagesPage>;
type ImagePage = FunctionReturnType<typeof api.galleries.getImagesPage>;
export type ImageSelection = NonNullable<PageArgs["selection"]>;

export function displayPageImages(
	source: PageData,
	rows: ImagePage["page"],
	previews: ImagePage["previewSources"] = [],
) {
	return resolveGalleryDisplayImages(
		rows.map((image) => ({
			...image,
			downloadUrl: source.gallery.downloadEnabled
				? galleryOriginalDownloadUrl(
						source.workerUrl,
						image.r2Key,
						source.token,
						source.accessGrant,
					)
				: null,
		})),
		source.workerUrl,
		{ token: source.token, accessGrant: source.accessGrant },
		previews,
	);
}

export function createGalleryCollection(
	getSnapshot: () => PageData,
	queryPage: (args: PageArgs) => Promise<ImagePage>,
) {
	const initial = untrack(getSnapshot);
	let images = $state.raw(initial.images);
	let nextCursor = $state(initial.imagePage?.cursor ?? null);
	let pageDone = $state(initial.imagePage?.isDone ?? true);
	let knownCount = $state(initial.gallery.imageCount);
	let loading = $state(false);
	let error = $state("");
	let visibleCount = $state(48);
	let selectedIds = $state.raw(new Set<Id<"galleryImages">>());
	let entireGallery = $state(false);
	let epoch = 0;
	let disposed = false;
	const totalCount = $derived(getSnapshot().imagePage ? knownCount : images.length);
	const selectedCount = $derived(
		entireGallery ? Math.max(0, totalCount - selectedIds.size) : selectedIds.size,
	);

	$effect(() => {
		const source = getSnapshot();
		epoch++;
		images = source.images;
		nextCursor = source.imagePage?.cursor ?? null;
		pageDone = source.imagePage?.isDone ?? true;
		knownCount = source.gallery.imageCount;
		loading = false;
		error = "";
		visibleCount = 48;
		selectedIds = new Set();
		entireGallery = false;
	});
	onDestroy(() => {
		disposed = true;
		epoch++;
	});

	function isCurrent(source: PageData, current: number) {
		return !disposed && current === epoch && source === getSnapshot();
	}

	async function loadNextPage() {
		if (pageDone || loading || disposed) return;
		const source = getSnapshot();
		const current = epoch;
		loading = true;
		error = "";
		try {
			const result = await queryPage({
				galleryId: source.gallery._id,
				token: source.token,
				accessGrant: source.accessGrant || undefined,
				cursor: nextCursor,
			});
			if (!isCurrent(source, current)) return;
			if (!result.isDone && result.continueCursor === nextCursor) {
				throw new Error("Cursor did not advance");
			}
			const seen = new Set(images.map((image) => image._id));
			const added = displayPageImages(source, result.page, result.previewSources).filter(
				(image) => {
					if (seen.has(image._id)) return false;
					seen.add(image._id);
					return true;
				},
			);
			images = [...images, ...added];
			knownCount = result.totalCount;
			nextCursor = result.continueCursor;
			pageDone = result.isDone;
		} catch {
			if (isCurrent(source, current)) error = "Couldn't load more files. Please try again.";
		} finally {
			if (isCurrent(source, current)) loading = false;
		}
	}

	return {
		get images(): Readonly<PageData["images"]> {
			return images;
		},
		get visibleCount() {
			return visibleCount;
		},
		get totalCount() {
			return totalCount;
		},
		get hasMore() {
			return !pageDone;
		},
		get loading() {
			return loading;
		},
		get error() {
			return error;
		},
		get selectedCount() {
			return selectedCount;
		},
		get allSelected() {
			return totalCount > 0 && selectedCount === totalCount;
		},
		get selection(): ImageSelection {
			const ids = [...selectedIds];
			return entireGallery ? { kind: "all", excludedIds: ids } : { kind: "selected", ids };
		},
		isSelected(id: Id<"galleryImages">) {
			return entireGallery ? !selectedIds.has(id) : selectedIds.has(id);
		},
		toggleSelection(id: Id<"galleryImages">) {
			const next = new Set(selectedIds);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			selectedIds = next;
		},
		selectAll() {
			entireGallery = true;
			selectedIds = new Set();
		},
		clearSelection() {
			entireGallery = false;
			selectedIds = new Set();
		},
		async revealMore(focusImage?: (id: Id<"galleryImages">) => void) {
			const source = getSnapshot();
			const current = epoch;
			const firstNewIndex = visibleCount;
			if (visibleCount >= images.length && !pageDone) await loadNextPage();
			if (!isCurrent(source, current)) return;
			visibleCount = Math.min(images.length, visibleCount + 48);
			await tick();
			if (isCurrent(source, current) && firstNewIndex < visibleCount) {
				focusImage?.(images[firstNewIndex]._id);
			}
		},
		async ensureIndex(index: number) {
			const source = getSnapshot();
			const current = epoch;
			if (index >= images.length && !pageDone) await loadNextPage();
			return isCurrent(source, current) ? (images[index] ?? null) : null;
		},
	};
}
