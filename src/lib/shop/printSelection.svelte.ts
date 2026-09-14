import { getAvailableFrames, isCanvasPaper } from "@jessepomeroy/print-catalog";
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
export function createPrintSelection(source: () => PrintSelectionSource) {
	let requestedPaper = $state("");
	let requestedSize = $state("");
	let requestedBorder = $state("none");
	let requestedFrame = $state("none");
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
			borderWidthValue: bordersEnabled && size ? requestedBorder : "none",
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
		},
		get size() {
			return size;
		},
		set size(value: string) {
			requestedSize = value;
		},
		get border() {
			return finish.borderWidthValue;
		},
		set border(value: string) {
			requestedBorder = value;
		},
		get frame() {
			return finish.frameValue;
		},
		set frame(value: string) {
			requestedFrame = value;
		},
		get configuration() {
			return configuration;
		},
	};
}

export type PrintSelection = ReturnType<typeof createPrintSelection>;
