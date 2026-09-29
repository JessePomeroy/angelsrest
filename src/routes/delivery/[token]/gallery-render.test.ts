import { render } from "svelte/server";
import { expect, test, vi } from "vitest";
import { deliveryData } from "../../../../tests/browser/fixtures/data";
import Page from "./+page.svelte";

vi.mock("convex-svelte", () => ({ setupConvex: vi.fn(), useConvexClient: () => ({}) }));

test("server rendering includes the initial metadata page before hydration", () => {
	const data = {
		...deliveryData,
		gallery: { ...deliveryData.gallery, imageCount: 110 },
		imagePage: { cursor: "next-page", isDone: false },
	};
	const { body } = render(Page, { props: { data, form: null } });
	expect(body.match(/class="grid-cell/g)).toHaveLength(data.images.length);
	expect(body).toContain("View item 1 of 110");
	expect(body).toContain("Show more");
});
