import { getAvailableFrames, getBorder, isCanvasPaper } from "@jessepomeroy/print-catalog";
import { replaceState } from "$app/navigation";
import { page } from "$app/state";
import {
	getAvailablePrintPapers,
	getAvailablePrintSizes,
	normalizePrintFinishSelection,
	type ResolvePrintConfigurationInput,
	resolvePrintConfiguration,
} from "./printConfigurator";

type PrintSelectionSource = Pick<
	ResolvePrintConfigurationInput,
	"variants" | "bordersEnabled" | "framedEnabled" | "frameMarkupMultiplier"
>;

/** One page owns each selection; the getter follows SvelteKit's reused page data. */
export function createPrintSelection(source: () => PrintSelectionSource, pathname?: () => string) {
	// The URL owns reloadable selections only for the route rendering this product.
	// Embedded product instances keep their own local selection.
	const selectionUrl = $derived(page.url.pathname === pathname?.() ? page.url : null);
	let requestedPaper = $derived(selectionUrl?.searchParams.get("paper") ?? "");
	let requestedSize = $derived(selectionUrl?.searchParams.get("size") ?? "");
	let requestedBorder = $derived(selectionUrl?.searchParams.get("border") ?? "none");
	let requestedFrame = $derived(selectionUrl?.searchParams.get("frame") ?? "none");
	const papers = $derived(getAvailablePrintPapers(source().variants));
	const paper = $derived(
		papers.some((option) => option.slug === requestedPaper)
			? requestedPaper
			: (papers[0]?.slug ?? ""),
	);
	const sizes = $derived(getAvailablePrintSizes(source().variants, paper));
	const size = $derived(
		sizes.some((option) => option.slug === requestedSize) ? requestedSize : (sizes[0]?.slug ?? ""),
	);
	const canvas = $derived(isCanvasPaper(paper));
	const bordersEnabled = $derived(source().bordersEnabled !== false && !canvas && Boolean(size));
	// The catalog requires a quarter-inch border for every frame.
	const framesEnabled = $derived(source().framedEnabled === true && bordersEnabled);
	const frames = $derived(getAvailableFrames(size));
	const finish = $derived(
		normalizePrintFinishSelection({
			paperSlug: paper,
			borderWidthValue:
				bordersEnabled && size ? (getBorder(requestedBorder)?.value ?? "none") : "none",
			frameValue:
				framesEnabled && size && frames.some((option) => option.value === requestedFrame)
					? requestedFrame
					: "none",
		}),
	);
	const configuration = $derived(
		resolvePrintConfiguration({
			...source(),
			...finish,
			sizeSlug: size,
		}),
	);

	// Discard invalid prior choices so they cannot reappear after a later navigation.
	$effect(() => {
		requestedPaper = paper;
		requestedSize = size;
		requestedBorder = finish.borderWidthValue;
		requestedFrame = finish.frameValue;
	});

	function persist() {
		if (!selectionUrl) return;
		const url = new URL(selectionUrl);
		url.searchParams.set("paper", paper);
		url.searchParams.set("size", size);
		url.searchParams.set("border", finish.borderWidthValue);
		url.searchParams.set("frame", finish.frameValue);
		replaceState(url, page.state);
	}

	return {
		get papers() {
			return papers;
		},
		get sizes() {
			return sizes;
		},
		get frames() {
			return frames;
		},
		get bordersEnabled() {
			return bordersEnabled;
		},
		get framesEnabled() {
			return framesEnabled;
		},
		get paper() {
			return paper;
		},
		set paper(value: string) {
			requestedPaper = value;
			persist();
		},
		get size() {
			return size;
		},
		set size(value: string) {
			requestedSize = value;
			persist();
		},
		get border() {
			return finish.borderWidthValue;
		},
		set border(value: string) {
			requestedBorder = value;
			persist();
		},
		get frame() {
			return finish.frameValue;
		},
		set frame(value: string) {
			requestedFrame = value;
			persist();
		},
		get configuration() {
			return configuration;
		},
	};
}

export type PrintSelection = ReturnType<typeof createPrintSelection>;
