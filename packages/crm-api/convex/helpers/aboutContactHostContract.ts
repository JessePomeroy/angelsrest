import type { AboutPageDraftPayload } from "./aboutPageValidators";
import type { ContactPageDraftPayload } from "./contactPageValidators";

export function requireAboutHostShape(payload: AboutPageDraftPayload) {
	if (payload.portraits?.length !== 1 || !payload.introduction?.trim()) {
		throw new Error("Imported About content requires one portrait and an introduction");
	}
}

export function requireContactHostShape(payload: ContactPageDraftPayload) {
	const paragraphs = payload.intro
		?.trim()
		.split(/\n\s*\n/)
		.map((paragraph) => paragraph.trim());
	if (!paragraphs?.length || paragraphs.length > 20 || paragraphs.some((value) => !value)) {
		throw new Error("Imported Contact content requires at most 20 plain paragraphs");
	}
	if (payload.bookingEnabled !== true) return;

	let parsed: URL;
	try {
		parsed = new URL(payload.bookingUrl ?? "");
	} catch {
		throw new Error("Imported Contact booking must use a Cal.com event URL");
	}
	if (
		parsed.protocol !== "https:"
		|| (parsed.hostname !== "cal.com" && parsed.hostname !== "www.cal.com")
		|| parsed.search
		|| parsed.hash
		|| !/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)+$/.test(
			parsed.pathname.replace(/^\/+|\/+$/g, ""),
		)
	) throw new Error("Imported Contact booking must use a Cal.com event URL");
}
