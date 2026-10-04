import { expect, test } from "vitest";
import { STRIPE_API_VERSION } from "../../src/stripeContract";
import { intakeEnvelopeDigest, MAX_INTAKE_ENVELOPE_BYTES, parseCommerceIntakeEnvelope, serializeCommerceIntakeEnvelope } from "./commerceIntakeEnvelope";
import { intakeScopeEnabled } from "./commerceIntakeJobs";

function fixture() {
	return { version: 1, role: "your-account", event: { id: "evt_codec1234567890123456", type: "checkout.session.completed",
		api_version: STRIPE_API_VERSION, created: 1790000000, livemode: false, account: null as string | null,
		session: { id: "cs_test_codec1234567890123456", mode: "payment",
			metadata: { commerceTenantSiteUrl: "angelsrest.online", zebra: "last", alpha: "first" },
			amount_total: 1200, amount_subtotal: 1000, currency: "usd", payment_status: "paid", livemode: false,
			created: 1790000000, expires_at: 1790086400, customer_email: "buyer@example.invalid",
			customer_details: { email: "buyer@example.invalid", name: "Fixture Buyer" },
			payment_intent: "pi_codec1234567890123456", shipping_details: null },
	} };
}

test("bounded projection is canonical across JSON and metadata ordering and retains required replay facts", async () => {
	const a = fixture(), b = fixture();
	b.event.session.metadata = { alpha: "first", zebra: "last", commerceTenantSiteUrl: "angelsrest.online" };
	const first = parseCommerceIntakeEnvelope(JSON.stringify(a));
	const second = parseCommerceIntakeEnvelope(JSON.stringify(b, null, 2));
	expect(first.eventJson).toBe(second.eventJson);
	expect(await intakeEnvelopeDigest(first.eventJson)).toBe(await intakeEnvelopeDigest(second.eventJson));
	expect(first.routingFacts).toEqual({ stripeSessionId: a.event.session.id, stripeTenantMetadataSiteUrl: "angelsrest.online" });
	expect(first.event.data.object.customer_details).toEqual(a.event.session.customer_details);
	expect(first.event.data.object).not.toHaveProperty("line_items");
});

test.each([
	["version", (value: ReturnType<typeof fixture>) => { value.version = 2; }],
	["API version", (value: ReturnType<typeof fixture>) => { Object.assign(value.event, { api_version: "2020-01-01" }); }],
	["account/destination", (value: ReturnType<typeof fixture>) => { value.event.account = "acct_fixture1234567890"; }],
	["session/event mode", (value: ReturnType<typeof fixture>) => { value.event.livemode = true; }],
	["mode/session ID", (value: ReturnType<typeof fixture>) => { value.event.session.id = "cs_live_codec1234567890123456"; }],
	["invoice", (value: ReturnType<typeof fixture>) => { Object.assign(value.event.session.metadata, { type: "invoice_payment" }); }],
	["unsafe timestamp", (value: ReturnType<typeof fixture>) => { value.event.created = Number.MAX_SAFE_INTEGER; }],
	["negative amount", (value: ReturnType<typeof fixture>) => { value.event.session.amount_total = -1; }],
	["unrecognized field", (value: ReturnType<typeof fixture>) => { Object.assign(value.event, { rawProviderData: "not retained" }); }],
	["metadata bound", (value: ReturnType<typeof fixture>) => { value.event.session.metadata.alpha = "x".repeat(501); }],
	["tenant identity", (value: ReturnType<typeof fixture>) => { Object.assign(value.event.session.metadata, { commerceTenantId: "not-a-tenant" }); }],
])("rejects unsupported %s", (_label, mutate) => {
	const input = fixture(); mutate(input);
	expect(() => parseCommerceIntakeEnvelope(JSON.stringify(input))).toThrow("Invalid commerce intake envelope");
});

test("connected account identity survives canonical replay", () => {
	const input = fixture(); input.role = "connected-accounts"; input.event.account = "acct_fixture1234567890";
	const parsed = parseCommerceIntakeEnvelope(JSON.stringify(input));
	expect(parsed.event.account).toBe(input.event.account);
	expect(parsed.routingFacts.stripeConnectedAccountId).toBe(input.event.account);
});

test("raw UTF-8 byte bounds apply before JSON parsing, independently of character count", () => {
	const oversized = "é".repeat(MAX_INTAKE_ENVELOPE_BYTES / 2 + 1);
	expect(oversized.length).toBeLessThan(MAX_INTAKE_ENVELOPE_BYTES);
	expect(() => parseCommerceIntakeEnvelope(oversized)).toThrow("Invalid commerce intake envelope");
});

test("SDK serialization projects only bounded replay fields", () => {
	const parsed = parseCommerceIntakeEnvelope(JSON.stringify(fixture()));
	const session = { ...parsed.event.data.object, object: "checkout.session", large_unused_field: "omit" };
	// The test intentionally models extra SDK fields at this provider boundary.
	const event = { ...parsed.event, data: { object: session }, unused: "omit" };
	const saved = serializeCommerceIntakeEnvelope(event, "your-account");
	expect(saved).toBe(parsed.eventJson);
	expect(saved).not.toContain("unused");
});

test.each(["garbage", '{"version":2,"sites":[]}', '{"version":1,"sites":[{"siteUrl":"a","mode":"test","extra":true}]}',
	'{"version":1,"sites":[{"siteUrl":"a","mode":"test"},{"siteUrl":"a","mode":"test"}]}'])
("malformed scope configuration fails closed: %s", raw => {
	expect(() => intakeScopeEnabled(raw, "a", false)).toThrow("configuration");
});
