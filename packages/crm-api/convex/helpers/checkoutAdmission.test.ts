import { describe, expect, test } from "vitest";
import {
	parseAdmissionBeginRequest,
	parseAdmissionBindRequest,
	parseAdmissionMarkCreatingRequest,
	parseAdmissionReleaseRequest,
	parseAdmissionUncertainRequest,
	parseCutoffRequest,
	parsePurposeActivationRequest,
} from "./checkoutAdmission";

const D1 = "1".repeat(64);
const D2 = "2".repeat(64);
const D3 = "3".repeat(64);
const D4 = "4".repeat(64);
const admissionId = "jh7123456789abcdefghijklmno";
const tenantId = "tenant_05eb6092-5d8c-43ce-ad26-1a59522bd07b";

describe("Checkout admission transport parsers", () => {
	test("accepts exact begin, lifecycle, bind, control, and cutoff bodies", () => {
		expect(parseAdmissionBeginRequest({
			version: 1,
			site: "angelsrest.online",
			account: null,
			attemptDigest: D1,
			proofClass: "same_origin_host_proof",
			admissionHandleHash: D2,
			requestFingerprint: D3,
			activeLeaseTokenHash: D4,
			hostGeneration: 1,
		})).not.toBeNull();
		expect(parseAdmissionBeginRequest({
			version: 1,
			site: "angelsrest.online",
			tenantId,
			account: null,
			attemptDigest: D1,
			proofClass: "same_origin_host_proof",
			admissionHandleHash: D2,
			requestFingerprint: D3,
			activeLeaseTokenHash: D4,
			hostGeneration: 1,
		})).toMatchObject({ tenantId });
		expect(parseAdmissionMarkCreatingRequest({
			version: 1,
			site: "angelsrest.online",
			admissionId,
			activeLeaseTokenHash: D4,
			requestFingerprint: D3,
			stripeIdempotencyDigest: D1,
		})).not.toBeNull();
		expect(parseAdmissionUncertainRequest({
			version: 1,
			site: "angelsrest.online",
			admissionId,
			requestFingerprint: D3,
			stripeIdempotencyDigest: D1,
		})).not.toBeNull();
		expect(parseAdmissionBindRequest({
			version: 1,
			site: "angelsrest.online",
			admissionId,
			requestFingerprint: D3,
			stripeIdempotencyDigest: D1,
			session: "cs_test_1234567890abcdefghijklmnop",
			stripeExpiresAt: Math.floor(Date.now() / 1000) + 3600,
			checkoutSnapshotHandle: null,
		})).not.toBeNull();
		expect(parseAdmissionReleaseRequest({
			version: 1,
			site: "angelsrest.online",
			admissionId,
			activeLeaseTokenHash: D4,
		})).not.toBeNull();
		expect(parsePurposeActivationRequest({
			version: 1,
			site: "angelsrest.online",
			purpose: "new_order_admission",
			state: "open",
			generation: 1,
			acceptedHostGeneration: 1,
		})).not.toBeNull();
		expect(parseCutoffRequest({
			version: 1,
			site: "angelsrest.online",
			account: null,
			activationGeneration: 1,
		})).not.toBeNull();
	});

	test("rejects extra fields, unknown tenants, malformed proof, and unsafe epochs", () => {
		expect(parseAdmissionBeginRequest({
			version: 1,
			site: "third.example",
			account: null,
			attemptDigest: D1,
			proofClass: "same_origin_host_proof",
			admissionHandleHash: D2,
			requestFingerprint: D3,
			activeLeaseTokenHash: D4,
			hostGeneration: 1,
		})).toBeNull();
		expect(parseAdmissionBeginRequest({
			version: 1,
			site: "angelsrest.online",
			tenantId: "angelsrest.online",
			account: null,
			attemptDigest: D1,
			proofClass: "same_origin_host_proof",
			admissionHandleHash: D2,
			requestFingerprint: D3,
			activeLeaseTokenHash: D4,
			hostGeneration: 1,
		})).toBeNull();
		expect(parsePurposeActivationRequest({
			version: 1,
			site: "angelsrest.online",
			purpose: "new_order_admission",
			state: "open",
			generation: 0,
			acceptedHostGeneration: 1,
		})).toBeNull();
		expect(parseCutoffRequest({
			version: 1,
			site: "angelsrest.online",
			account: "acct_wrong",
			activationGeneration: 1,
		})).toBeNull();
	});
});
