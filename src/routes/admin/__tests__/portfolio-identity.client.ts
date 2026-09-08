import { mount, tick, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PortfolioRouteHarness from "./PortfolioRouteHarness.svelte";

type SaveArgs = {
	galleryId: string;
	expectedDraftRevisionId?: string;
	draft: { title: string; slug: string };
};

const editor = vi.hoisted(() => ({
	mutation: vi.fn<(_query: unknown, args: SaveArgs) => Promise<{ revisionId: string }>>(),
	data: Object.fromEntries(
		[
			["A", "Alpha"],
			["B", "Beta"],
		].map(([galleryId, title]) => [
			galleryId,
			{
				galleryId,
				slug: title.toLowerCase(),
				isPublished: false,
				isVisible: true,
				draft: {
					revisionId: `revision-${galleryId}`,
					title,
					slug: title.toLowerCase(),
					placements: [],
				},
			},
		]),
	),
}));

// Keep the installed editor and its recovery/autosave logic real. Only external
// transport and unrelated media/workbench presentation are replaced.
vi.mock("@jessepomeroy/admin", async () => ({
	PortfolioGalleryPage: (
		await import(
			"../../../../node_modules/@jessepomeroy/admin/dist/pages/editor/PortfolioGalleryPage.svelte"
		)
	).default,
}));
vi.mock("../../../../node_modules/@jessepomeroy/admin/dist/config.js", () => ({
	getAdminConfig: () => ({
		siteUrl: "angelsrest.test",
		siteName: "Test portfolio",
		api: { portfolioEditor: { getEditorState: "get", saveDraft: "save" } },
		editor: { portfolio: { mediaBaseUrl: "https://media.example.test" } },
	}),
}));
vi.mock("../../../../node_modules/@jessepomeroy/admin/dist/adminClient.js", () => ({
	useAdminClient: () => ({ mutation: editor.mutation }),
}));
vi.mock("convex-svelte", () => ({
	useQuery: (_query: unknown, args: () => { galleryId: string }) => ({
		get data() {
			return editor.data[args().galleryId];
		},
		error: undefined,
	}),
}));
vi.mock("../../../../node_modules/@jessepomeroy/admin/dist/editorMedia.svelte.js", () => ({
	createEditorMedia: () => ({ byId: new Map(), ready: [], error: undefined }),
}));
vi.mock(
	"../../../../node_modules/@jessepomeroy/admin/dist/pages/editor/PortfolioWorkbench.svelte",
	() => ({
		default: (anchor: unknown, props: { children?: (anchor: unknown) => void }) =>
			props.children?.(anchor),
	}),
);
vi.mock(
	"../../../../node_modules/@jessepomeroy/admin/dist/pages/editor/PortfolioGalleryImages.svelte",
	() => ({ default: () => undefined }),
);
vi.mock(
	"../../../../node_modules/@jessepomeroy/admin/dist/pages/editor/PortfolioMediaPicker.svelte",
	() => ({ default: () => undefined }),
);
vi.mock(
	"../../../../node_modules/@jessepomeroy/admin/dist/pages/editor/PortfolioPublishReview.svelte",
	() => ({ default: () => undefined }),
);

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: Error) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

function recoveryKey(galleryId: string) {
	return `admin:portfolio-editor:angelsrest.test:${galleryId}`;
}

function storedDraft(galleryId: string) {
	const value = localStorage.getItem(recoveryKey(galleryId));
	return value ? JSON.parse(value) : null;
}

function titleInput() {
	const input = document.querySelector<HTMLInputElement>("#gallery-title");
	if (!input) throw new Error("Expected the real gallery title input");
	return input;
}

async function editTitle(title: string) {
	const input = titleInput();
	input.value = title;
	input.dispatchEvent(new Event("input", { bubbles: true }));
	await tick();
}

describe("portfolio route document identity", () => {
	let component: ReturnType<typeof PortfolioRouteHarness> | undefined;

	beforeEach(async () => {
		vi.useFakeTimers();
		vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
		editor.mutation.mockReset().mockResolvedValue({ revisionId: "saved-revision" });
		component = mount(PortfolioRouteHarness, { target: document.body });
		await tick();
	});

	afterEach(async () => {
		if (component) await unmount(component);
		component = undefined;
		document.body.replaceChildren();
		localStorage.clear();
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	async function navigate(galleryId: string) {
		if (!component) throw new Error("Expected a mounted route");
		component.navigate(galleryId);
		await tick();
	}

	it("keeps a pending A draft out of B and cancels A's debounce on navigation", async () => {
		await editTitle("Alpha edited");
		await navigate("B");
		expect(titleInput().value).toBe("Beta");
		expect(storedDraft("A")).toMatchObject({
			baseRevisionId: "revision-A",
			payload: { title: "Alpha edited" },
		});
		expect(storedDraft("B")).toBeNull();
		await vi.advanceTimersByTimeAsync(901);
		expect(editor.mutation).not.toHaveBeenCalled();
	});

	it("restores offline work only when returning to its own gallery", async () => {
		vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
		window.dispatchEvent(new Event("offline"));
		await editTitle("Alpha offline");
		await navigate("B");
		expect(titleInput().value).toBe("Beta");
		await editTitle("Beta offline");
		await navigate("A");
		expect(titleInput().value).toBe("Alpha offline");
		expect(storedDraft("B")).toMatchObject({
			baseRevisionId: "revision-B",
			payload: { title: "Beta offline" },
		});
		await vi.advanceTimersByTimeAsync(901);
		expect(editor.mutation).not.toHaveBeenCalled();
	});

	it.each([
		"success",
		"rejection",
	] as const)("does not let A's late %s touch B's recovery draft or revision", async (outcome) => {
		const pending = deferred<{ revisionId: string }>();
		editor.mutation.mockReturnValueOnce(pending.promise);
		await editTitle("Alpha edited");
		await vi.advanceTimersByTimeAsync(901);
		expect(editor.mutation).toHaveBeenNthCalledWith(
			1,
			"save",
			expect.objectContaining({
				galleryId: "A",
				expectedDraftRevisionId: "revision-A",
				draft: expect.objectContaining({ title: "Alpha edited" }),
			}),
		);
		await navigate("B");
		await editTitle("Beta edited");
		const recoveryBefore = localStorage.getItem(recoveryKey("B"));
		expect(storedDraft("B")).toMatchObject({
			baseRevisionId: "revision-B",
			payload: { title: "Beta edited" },
		});
		if (outcome === "success") pending.resolve({ revisionId: "revision-A-saved" });
		else pending.reject(new Error("Save failed for Alpha"));
		await pending.promise.catch(() => undefined);
		await tick();
		expect(localStorage.getItem(recoveryKey("B"))).toBe(recoveryBefore);
		expect(titleInput().value).toBe("Beta edited");
		expect(document.querySelector('[role="alert"]')).toBeNull();
		await vi.advanceTimersByTimeAsync(901);
		expect(editor.mutation).toHaveBeenNthCalledWith(
			2,
			"save",
			expect.objectContaining({
				galleryId: "B",
				expectedDraftRevisionId: "revision-B",
				draft: expect.objectContaining({ title: "Beta edited" }),
			}),
		);
	});

	it("preserves an edit through a same-gallery data refresh and saves normally", async () => {
		await editTitle("Alpha edited");
		const inputBefore = titleInput();
		await navigate("A");
		expect(titleInput()).toBe(inputBefore);
		expect(titleInput().value).toBe("Alpha edited");
		await vi.advanceTimersByTimeAsync(901);
		expect(editor.mutation).toHaveBeenCalledExactlyOnceWith(
			"save",
			expect.objectContaining({
				galleryId: "A",
				expectedDraftRevisionId: "revision-A",
				draft: expect.objectContaining({ title: "Alpha edited" }),
			}),
		);
		expect(storedDraft("A")).toBeNull();
		expect(document.body.textContent).toContain("draft saved");
	});

	it.each([
		"success",
		"rejection",
	] as const)("preserves newly recovered A edits when its earlier instance's save ends in %s", async (outcome) => {
		const pending = deferred<{ revisionId: string }>();
		editor.mutation.mockReturnValueOnce(pending.promise);
		await editTitle("Alpha first edit");
		await vi.advanceTimersByTimeAsync(901);
		expect(editor.mutation).toHaveBeenCalledTimes(1);
		await navigate("B");
		await navigate("A");
		await editTitle("Alpha newer edit");
		const recoveryBefore = localStorage.getItem(recoveryKey("A"));
		expect(storedDraft("A")).toMatchObject({ payload: { title: "Alpha newer edit" } });
		if (outcome === "success") pending.resolve({ revisionId: "revision-A-saved" });
		else pending.reject(new Error("Old Alpha save failed"));
		await pending.promise.catch(() => undefined);
		await tick();
		expect(localStorage.getItem(recoveryKey("A"))).toBe(recoveryBefore);
		expect(titleInput().value).toBe("Alpha newer edit");
		expect(document.querySelector('[role="alert"]')).toBeNull();
	});

	it("retains a conflicting draft for recovery without retrying or affecting B", async () => {
		editor.mutation.mockRejectedValueOnce(new Error("Revision conflict"));
		await editTitle("Alpha conflicted");
		await vi.advanceTimersByTimeAsync(901);
		expect(document.querySelector('[role="alert"]')?.textContent).toBe("Revision conflict");
		expect(storedDraft("A")).toMatchObject({
			baseRevisionId: "revision-A",
			payload: { title: "Alpha conflicted" },
		});
		await vi.advanceTimersByTimeAsync(2000);
		expect(editor.mutation).toHaveBeenCalledTimes(1);
		await navigate("B");
		expect(titleInput().value).toBe("Beta");
		expect(document.querySelector('[role="alert"]')).toBeNull();
		expect(storedDraft("B")).toBeNull();
	});
});
