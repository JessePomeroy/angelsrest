import { render } from "svelte/server";
import { describe, expect, it } from "vitest";
import PrivateCapabilityHead from "./PrivateCapabilityHead.svelte";

describe("PrivateCapabilityHead", () => {
	it("emits capability-safe crawler and referrer metadata", () => {
		const { head } = render(PrivateCapabilityHead, {
			props: { title: "Private client document" },
		});
		expect(head).toContain("<title>Private client document</title>");
		expect(head).toContain('name="robots" content="noindex, nofollow, noarchive"');
		expect(head).toContain('name="googlebot" content="noindex, nofollow, noarchive"');
		expect(head).toContain('name="referrer" content="no-referrer"');
		expect(head).not.toContain("index, follow");
	});
});
