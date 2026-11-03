import { describe, expect, test, vi } from "vitest";
import { compareHistory, decimalId, filePolicy } from "./policy";
import {
	addressList,
	composeReply,
	decodeHeader,
	gmailClient,
	historyPage,
	normalizeMessage,
	openToken,
	parseLosslessJson,
	sealToken,
	verifyFile,
} from "./protocol";

const png = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=",
	"base64",
);
const key = Buffer.alloc(32, 7).toString("base64url");
const expected = {
	threadId: "thread1",
	recipient: "guest@example.test",
	mailbox: "owner@example.test",
};
function raw(headers: { name: string; value: string }[] = []) {
	return {
		id: "message1",
		threadId: "thread1",
		internalDate: String(Date.now()),
		labelIds: ["INBOX"],
		payload: {
			mimeType: "text/plain",
			headers: [
				{ name: "From", value: '"Guest, Example" <guest@example.test>' },
				{ name: "To", value: "owner@example.test" },
				{ name: "Message-ID", value: "<reply@example.test>" },
				{ name: "Subject", value: "Hello" },
				...headers,
			],
			body: {
				data: Buffer.from("Keep MY Case\n<script>Not executable</script>").toString("base64url"),
			},
		},
	};
}
describe("Gmail production protocol lessons", () => {
	test("preserves numeric history IDs above safe integer range without Node-specific JSON reviver behavior", () => {
		expect(
			parseLosslessJson(
				'{"emailAddress":"owner@example.test","historyId":90071992547409931234,"text":"historyId:90071992547409931234"}',
			),
		).toEqual({
			emailAddress: "owner@example.test",
			historyId: "90071992547409931234",
			text: "historyId:90071992547409931234",
		});
		expect(decimalId(1234)).toBe("1234");
		expect(() => decimalId(Number.MAX_SAFE_INTEGER + 2)).toThrow();
		expect(compareHistory("999999999999999999", "1000000000000000000")).toBe(-1);
	});
	test("retains complete history pagination and sent-label changes, with Gmail-ID deduplication only", () => {
		const page = historyPage({
			historyId: "1000",
			nextPageToken: "next",
			history: [
				{
					messages: [{ id: "one", threadId: "thread1" }],
					messagesAdded: [{ message: { id: "one", threadId: "thread1" } }],
					labelsAdded: [{ message: { id: "two", threadId: "thread1" } }],
				},
			],
		});
		expect(page).toMatchObject({
			done: false,
			nextPageToken: "next",
			refs: [
				{ id: "one", threadId: "thread1" },
				{ id: "two", threadId: "thread1" },
			],
		});
	});
	test("binds encrypted refresh tokens to their tenant and detects modifications", () => {
		const sealed = sealToken("synthetic-refresh", "one.test", key);
		expect(sealed).not.toContain("synthetic-refresh");
		expect(openToken(sealed, "one.test", key)).toBe("synthetic-refresh");
		expect(() => openToken(sealed, "two.test", key)).toThrow();
		expect(() => openToken(`${sealed}x`, "one.test", key)).toThrow();
	});
	test("plain text stays inert and retains capitalization; quoted display-name commas and RFC headers work", () => {
		const result = normalizeMessage(raw(), expected);
		expect(result.text).toContain("Keep MY Case\n<script>Not executable</script>");
		expect(result.blocked).toBeUndefined();
		expect(addressList('"Guest, Example" <guest@example.test>, owner@example.test')).toEqual([
			"guest@example.test",
			"owner@example.test",
		]);
		expect(decodeHeader("=?UTF-8?B?SGVsbG8=?=")).toBe("Hello");
	});
	test("unexpected CC, forged From and ambiguous headers are withheld without importing attachments or arbitrary content", () => {
		const m = raw([{ name: "Cc", value: "unrelated@example.test" }]);
		const result = normalizeMessage(m, expected);
		expect(result.blocked).toBeTruthy();
		expect(result.text).not.toContain("Keep MY Case");
		expect(result.attachments).toEqual([]);
		expect(
			normalizeMessage(raw([{ name: "From", value: "attacker@example.test" }]), expected).blocked,
		).toBeTruthy();
	});
	test("files use explicit byte/type/count limits, preserve blocked metadata and reject MIME-type spoofing", () => {
		expect(filePolicy("photo.svg", "image/svg+xml", 100)).toBeTruthy();
		expect(filePolicy("huge.pdf", "application/pdf", 4 * 1024 * 1024)).toBeTruthy();
		expect(() => verifyFile(png, "image/png", png.length)).not.toThrow();
		expect(() => verifyFile(Buffer.from("<script>bad</script>"), "image/png", 20)).toThrow();
		const m = raw();
		Object.assign(m.payload, {
			parts: [
				{
					partId: "1",
					filename: "unsupported.exe",
					mimeType: "application/octet-stream",
					body: { size: 100, attachmentId: "attachment1" },
				},
			],
		});
		expect(normalizeMessage(m, expected).attachments[0]).toMatchObject({
			name: "unsupported.exe",
			blocked: "unsupported file type",
		});
	});
	test("composes fixed recipients and thread references, includes every selected file and refuses header injection", () => {
		const attempt = {
			sendId: "synthetic-attempt",
			rfcId: "<unique@example.test>",
			recipient: expected.recipient,
			subject: "Same subject",
			text: "Hello There",
			threadId: "thread1",
			parentRfcId: "<parent@example.test>",
		};
		const mime = Buffer.from(
			composeReply(attempt, expected.mailbox, [
				{ name: "image.png", type: "image/png", bytes: png },
			]),
			"base64url",
		).toString();
		expect(mime).toContain("To: guest@example.test\r\n");
		expect(mime).toContain("X-Angels-Rest-Send-ID: synthetic-attempt\r\n");
		expect(mime).toContain("In-Reply-To: <parent@example.test>");
		expect(mime).toContain("Content-Type: image/png");
		expect(mime).toContain('Content-Disposition: attachment; filename="image.png"\r\n');
		expect(mime).not.toContain("Bcc:");
		expect(() => composeReply({ ...attempt, sendId: "id\r\nBcc: attacker@example.test" }, expected.mailbox, [])).toThrow();
		expect(() =>
			composeReply(
				{ ...attempt, subject: "Hello\r\nBcc: attacker@example.test" },
				expected.mailbox,
				[],
			),
		).toThrow();
	});
	test.each([
		['reference "one".png', 'filename="reference \\"one\\".png"'],
		["référence.png", "filename*=UTF-8''r%C3%A9f%C3%A9rence.png"],
	])("preserves the attachment filename %s without a competing fallback", (name, parameter) => {
		const mime = Buffer.from(
			composeReply(
				{
					sendId: "synthetic-filename-attempt",
					rfcId: "<filename@example.test>",
					recipient: expected.recipient,
					subject: "Filename regression",
					text: "Synthetic attachment",
				},
				expected.mailbox,
				[{ name, type: "image/png", bytes: png }],
			),
			"base64url",
		).toString();
		expect(mime).toContain(`Content-Disposition: attachment; ${parameter}\r\n`);
	});
	test("stop alone accepts an empty 204; send requires a real provider result and never retries automatically", async () => {
		const fetcher = vi.fn(async () => new Response(null, { status: 204 }));
		const gmail = gmailClient("synthetic-access", fetcher);
		await expect(gmail("/stop", {})).resolves.toEqual({});
		await expect(gmail("/messages/send", { raw: "synthetic" })).rejects.toThrow();
		expect(fetcher).toHaveBeenCalledTimes(2);
	});
});

test("inline attachment metadata stays bounded while retaining visible rejected files", () => {
	const message = raw();
	const result = normalizeMessage(
		{
			...message,
			payload: {
				...message.payload,
				mimeType: "multipart/mixed",
				parts: Array.from({ length: 5 }, (_, i) => ({
					partId: String(i),
					filename: `photo-${i}.png`,
					mimeType: "image/png",
					body: { size: 1000, data: "A".repeat(19000) },
				})),
			},
		},
		expected,
	);
	expect(result.attachments).toHaveLength(5);
	expect(result.attachments.filter((f) => f.blocked)).toHaveLength(2);
	expect(
		result.attachments.reduce((size, f) => size + (f.inlineData?.length ?? 0), 0),
	).toBeLessThanOrEqual(64000);
});
