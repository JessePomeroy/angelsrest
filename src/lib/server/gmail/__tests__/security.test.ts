import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, test, vi } from "vitest";
import { parseLosslessJson } from "../../../../../packages/crm-api/convex/helpers/gmail/protocol";
import {
	boundedBody,
	createPushVerifier,
	noticeData,
	parseNotice,
	returnPath,
	sameOrigin,
} from "../security";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const now = 1793664000000,
	seconds = now / 1000;
const identity = {
	audience: "https://admin.example.test/api/webhooks/gmail",
	serviceAccount: "push@synthetic-project.iam.gserviceaccount.com",
};
function jwt(patch = {}, headerPatch = {}, signer = privateKey) {
	const header = Buffer.from(
		JSON.stringify({ alg: "RS256", kid: "synthetic-key", ...headerPatch }),
	).toString("base64url");
	const body = Buffer.from(
		JSON.stringify({
			iss: "https://accounts.google.com",
			aud: identity.audience,
			sub: "123456789",
			email: identity.serviceAccount,
			email_verified: true,
			iat: seconds - 30,
			exp: seconds + 3600,
			...patch,
		}),
	).toString("base64url");
	return `Bearer ${header}.${body}.${sign("RSA-SHA256", Buffer.from(`${header}.${body}`), signer).toString("base64url")}`;
}
function verifier() {
	const fetcher = vi.fn(async (_input: string | URL | Request) =>
		Response.json({
			keys: [
				{ ...publicKey.export({ format: "jwk" }), kid: "synthetic-key", alg: "RS256", use: "sig" },
			],
		}),
	);
	return { fetcher, verify: createPushVerifier(fetcher, () => now) };
}
describe("deployed Pub/Sub authentication boundary", () => {
	test("checks a real RSA signature against the trusted JWKS key material and caches bounded keys", async () => {
		const v = verifier();
		await expect(v.verify(jwt(), identity)).resolves.toBeUndefined();
		await v.verify(jwt(), identity);
		expect(v.fetcher).toHaveBeenCalledTimes(1);
		expect(v.fetcher.mock.calls[0][0]).toBe("https://www.googleapis.com/oauth2/v3/certs");
	});
	test.each([
		{ aud: "https://different.example" },
		{ iss: "https://attacker.example" },
		{ email: "attacker@synthetic-project.iam.gserviceaccount.com" },
		{ email_verified: false },
		{ exp: seconds - 100 },
		{ iat: seconds + 100 },
		{ sub: "" },
		{ nbf: seconds + 100 },
	])("rejects a signed token with unexpected claims: %j", async (patch) => {
		await expect(verifier().verify(jwt(patch), identity)).rejects.toThrow();
	});
	test("rejects algorithm confusion, attacker-provided key URLs and an unrelated signing key", async () => {
		await expect(verifier().verify(jwt({}, { alg: "HS256" }), identity)).rejects.toThrow();
		await expect(
			verifier().verify(jwt({}, { jku: "https://attacker.example/keys" }), identity),
		).rejects.toThrow();
		const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
		await expect(verifier().verify(jwt({}, {}, other.privateKey), identity)).rejects.toThrow();
	});
	test("requires the exact subscription and preserves a large numeric Gmail history identifier", () => {
		const subscription = "projects/synthetic-project/subscriptions/updates";
		const raw = {
			subscription,
			message: {
				messageId: "567890",
				data: Buffer.from(
					'{"emailAddress":"owner@example.test","historyId":90071992547409931234}',
				).toString("base64"),
			},
		};
		const envelope = parseNotice(raw, subscription),
			data = noticeData(parseLosslessJson(envelope.text));
		expect(data.historyId).toBe("90071992547409931234");
		expect(data.address).toBe("owner@example.test");
		expect(() => parseNotice(raw, `${subscription}-foreign`)).toThrow();
	});
});
describe("private admin request boundaries", () => {
	test("requires same-origin writes and permits only the intended admin callback destinations", () => {
		expect(() =>
			sameOrigin(
				new Request("https://admin.example.test/action", {
					method: "POST",
					headers: { origin: "https://foreign.example" },
				}),
				"https://admin.example.test",
			),
		).toThrow();
		expect(
			returnPath("https://attacker.example/admin/inquiries", "https://admin.example.test"),
		).toBe("/admin/inquiries");
		expect(returnPath("/admin/crm?client=synthetic", "https://admin.example.test")).toBe(
			"/admin/crm?client=synthetic",
		);
	});
	test("bounds actual streamed request bytes even without Content-Length", async () => {
		await expect(
			boundedBody(new Request("https://fixture.test", { method: "POST", body: "123456" }), 5),
		).rejects.toThrow();
		await expect(
			boundedBody(new Request("https://fixture.test", { method: "POST", body: "12345" }), 5),
		).resolves.toHaveLength(5);
	});
});
