/** Pure, dependency-free HTML escaping shared by server-rendered email bodies. */

const HTML_ESCAPE: Record<string, string> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
	"'": "&#39;",
};

export function escapeHtml(value: string) {
	return value.replace(/[&<>"']/g, (character) => HTML_ESCAPE[character] ?? character);
}

/** Escape each line and join with `<br>`, accepting LF or CRLF line endings. */
export function escapedLines(value: string) {
	return value.split(/\r?\n/).map(escapeHtml).join("<br>");
}
