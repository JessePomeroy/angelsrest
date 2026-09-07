import type { Page } from "@playwright/test";

// Compare colors using each engine's serialization, including its float precision.
export async function computedColor(page: Page, color: string): Promise<string> {
	return page.evaluate((value) => {
		const sample = document.createElement("span");
		sample.style.color = value;
		document.body.append(sample);
		try {
			return getComputedStyle(sample).color;
		} finally {
			sample.remove();
		}
	}, color);
}
