import type { Id } from "../../packages/crm-api/convex/_generated/dataModel";
import {
	type AboutContactMigrationPurpose,
	aboutContactMigrationCapabilityFor,
} from "../../packages/crm-api/convex/helpers/aboutContactMigrationCapability";
import { digestAboutContactMediaAttestation } from "../../packages/crm-api/convex/helpers/aboutContactMigrationStore";
import {
	ANGELS_REST_ABOUT_PARITY_SEED,
	ANGELS_REST_CONTACT_PARITY_SEED,
	createSanityAboutContactPlan,
	digestSanityAboutContactPlan,
	requireSanityAboutContactPlan,
	type SanityAboutContactPlan,
	type SanityAboutContactSource,
} from "../../packages/crm-api/convex/helpers/sanityAboutContactPlan";
import {
	type AboutContactPortraitReceipt,
	parseAboutContactPortraitReceipt,
} from "./aboutContactPortraitTransfer";

export const ABOUT_CONTACT_PLAN_OPERATION = "R6-about-contact-preservation-v1" as const;
export const ABOUT_CONTACT_PLAN_FILE = "ABOUT-CONTACT-PLAN.json" as const;
export const ABOUT_CONTACT_COMMANDS_FILE = "OPERATOR-COMMANDS.txt" as const;
export const ABOUT_CONTACT_CAPABILITY_FILES = {
	attest: "01-attest.env",
	import: "02-import.env",
	publish: "03-publish.env",
} as const;

export const ABOUT_CONTACT_PLAN_BINDINGS = {
	projectId: "n7rvza4g",
	dataset: "production",
	siteUrl: "angelsrest.online",
	deployment: "loyal-swan-967",
	migrationId: "R6-about-contact-2026-08-23",
	decisionSetId: "R6-about-contact-current-behavior-2026-08-23",
	portraitAltText: "Jesse Pomeroy",
	planSourceSha256: "8d28dcbf334fd298045872d25d9419f4dbd4e1919f94951cc42663c906fdd150",
	aboutSourceId: "1450e80b-0632-4b6e-9872-a0b37613d44e",
	aboutSourceRevision: "0oFX1HjggfKYZSiwvjNCAx",
	contactSourceId: "8cb60fab-7420-457d-b316-c6a3f99e9d2b",
	contactSourceRevision: "wP6EQO6WASyr6NrTg1vG1z",
} as const;

type JsonRecord = Record<string, unknown>;

type AttestationArgs = {
	siteUrl: string;
	mediaAssetId: Id<"mediaAssets">;
	workerAssetId: string;
	sourceSha256: string;
	sourceWidth: number;
	sourceHeight: number;
	receiptDigest: string;
};

type OperatorCall<Name extends string, Purpose extends AboutContactMigrationPurpose, Args> = {
	functionName: Name;
	purpose: Purpose;
	binding: string;
	replayCount: 2;
	args: Args;
};

export type AboutContactPlanArtifact = {
	version: 1;
	operation: typeof ABOUT_CONTACT_PLAN_OPERATION;
	sourceDigest: typeof ABOUT_CONTACT_PLAN_BINDINGS.planSourceSha256;
	plan: SanityAboutContactPlan;
	digest: string;
	calls: {
		attest: OperatorCall<
			"aboutContactMigration:attestMediaSource",
			"about-contact-media-attest-v1",
			AttestationArgs
		>;
		import: OperatorCall<
			"aboutContactMigration:importDrafts",
			"sanity-about-contact-import-v1",
			{ plan: SanityAboutContactPlan; digest: string }
		>;
		publish: OperatorCall<
			"aboutContactMigration:publishDrafts",
			"sanity-about-contact-publish-v1",
			{ plan: SanityAboutContactPlan; digest: string }
		>;
	};
};

function record(value: unknown, label: string): JsonRecord {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${label} must be a JSON object`);
	}
	return value as JsonRecord;
}

function exactKeys(value: JsonRecord, expected: readonly string[], label: string) {
	const actual = Object.keys(value).sort();
	const required = [...expected].sort();
	if (actual.length !== required.length || actual.some((key, index) => key !== required[index])) {
		throw new Error(`${label} has an unexpected shape`);
	}
}

function canonicalJson(value: unknown): string {
	if (value === null) return "null";
	if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw new Error("Artifact contains a non-finite number");
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (typeof value === "object") {
		return `{${Object.entries(value as JsonRecord)
			.filter(([, entry]) => entry !== undefined)
			.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
			.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
			.join(",")}}`;
	}
	throw new Error("Artifact contains an unsupported value");
}

function sourceSingleton(source: SanityAboutContactSource, key: "about" | "contact") {
	const documents = source[key];
	if (documents.length !== 1) throw new Error(`Exactly one ${key} source document is required`);
	return record(documents[0], `${key} source document`);
}

function isAbsent(value: unknown) {
	return value === undefined || value === null || value === "";
}

function assertAuthorizedSourceShape(source: SanityAboutContactSource) {
	const about = sourceSingleton(source, "about");
	const contact = sourceSingleton(source, "contact");
	if (
		about._id !== ABOUT_CONTACT_PLAN_BINDINGS.aboutSourceId ||
		about._rev !== ABOUT_CONTACT_PLAN_BINDINGS.aboutSourceRevision ||
		contact._id !== ABOUT_CONTACT_PLAN_BINDINGS.contactSourceId ||
		contact._rev !== ABOUT_CONTACT_PLAN_BINDINGS.contactSourceRevision
	) {
		throw new Error("About/Contact source identities do not match the sealed live inventory");
	}
	if (!isAbsent(about.heading)) {
		throw new Error("The authorized About heading fallback requires an absent source heading");
	}
	if (!isAbsent(about.plainBio)) {
		throw new Error("The authorized absent biography requires an absent source plainBio");
	}
	if (
		about.fullBio !== undefined &&
		about.fullBio !== null &&
		(!Array.isArray(about.fullBio) || about.fullBio.length !== 0)
	) {
		throw new Error("The authorized absent biography requires an absent source fullBio");
	}
	if (about.seo !== undefined && about.seo !== null) {
		const seo = record(about.seo, "About SEO");
		if (!isAbsent(seo.description) || !isAbsent(seo.ogImageUrl)) {
			throw new Error("The authorized About SEO fallback requires absent source SEO values");
		}
	}
	if (
		contact.bookingTypes !== undefined &&
		contact.bookingTypes !== null &&
		(!Array.isArray(contact.bookingTypes) || contact.bookingTypes.length !== 0)
	) {
		throw new Error("The authorized bookingTypes omission requires an absent source value");
	}
}

/** Accept only the fresh planner boundary: one object with About and Contact arrays. */
export function parseAboutContactPlanSource(value: unknown): SanityAboutContactSource {
	const source = record(value, "About/Contact source");
	exactKeys(source, ["about", "contact"], "About/Contact source");
	if (!Array.isArray(source.about) || !Array.isArray(source.contact)) {
		throw new Error("About/Contact source must contain About and Contact arrays");
	}
	return { about: source.about, contact: source.contact };
}

export async function digestAboutContactPlanSource(source: SanityAboutContactSource) {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(canonicalJson(source)),
	);
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function createCalls(
	plan: SanityAboutContactPlan,
	digest: string,
): Promise<AboutContactPlanArtifact["calls"]> {
	const portrait = plan.decisionSet.aboutPortrait;
	const attestArgs: AttestationArgs = {
		siteUrl: plan.siteUrl,
		mediaAssetId: portrait.targetMediaAssetId,
		workerAssetId: portrait.targetWorkerAssetId,
		sourceSha256:
			portrait.action === "use-local-portrait-owner-approved"
				? portrait.localSha256
				: portrait.sourceSha256,
		sourceWidth:
			portrait.action === "use-local-portrait-owner-approved"
				? portrait.localWidth
				: portrait.sourceWidth,
		sourceHeight:
			portrait.action === "use-local-portrait-owner-approved"
				? portrait.localHeight
				: portrait.sourceHeight,
		receiptDigest: portrait.targetReceiptSha256,
	};
	const attestationDigest = await digestAboutContactMediaAttestation(attestArgs);
	return {
		attest: {
			functionName: "aboutContactMigration:attestMediaSource",
			purpose: "about-contact-media-attest-v1",
			binding: attestationDigest,
			replayCount: 2,
			args: attestArgs,
		},
		import: {
			functionName: "aboutContactMigration:importDrafts",
			purpose: "sanity-about-contact-import-v1",
			binding: digest,
			replayCount: 2,
			args: { plan, digest },
		},
		publish: {
			functionName: "aboutContactMigration:publishDrafts",
			purpose: "sanity-about-contact-publish-v1",
			binding: digest,
			replayCount: 2,
			args: { plan, digest },
		},
	};
}

/** Build the exact already-authorized preservation plan without provider access. */
export async function createAboutContactPlanArtifact(
	source: SanityAboutContactSource,
	portraitReceiptValue: unknown,
): Promise<AboutContactPlanArtifact> {
	assertAuthorizedSourceShape(source);
	const sourceDigest = await digestAboutContactPlanSource(source);
	if (sourceDigest !== ABOUT_CONTACT_PLAN_BINDINGS.planSourceSha256) {
		throw new Error("About/Contact source bytes do not match the sealed live inventory");
	}
	const receipt: AboutContactPortraitReceipt =
		parseAboutContactPortraitReceipt(portraitReceiptValue);
	const plan = createSanityAboutContactPlan(source, {
		migrationId: ABOUT_CONTACT_PLAN_BINDINGS.migrationId,
		siteUrl: ABOUT_CONTACT_PLAN_BINDINGS.siteUrl,
		source: {
			projectId: ABOUT_CONTACT_PLAN_BINDINGS.projectId,
			dataset: ABOUT_CONTACT_PLAN_BINDINGS.dataset,
			perspective: "published",
		},
		decisions: {
			id: ABOUT_CONTACT_PLAN_BINDINGS.decisionSetId,
			aboutHeading: { action: "use-host-fallback-owner-approved" },
			aboutBiography: { action: "confirmed-absent-owner-approved" },
			aboutPortrait: {
				action: "use-local-portrait-owner-approved",
				targetMediaAssetId: receipt.mediaAssetId as Id<"mediaAssets">,
				targetWorkerAssetId: receipt.workerAssetId,
				targetReceiptSha256: receipt.receiptDigest,
				altText: ABOUT_CONTACT_PLAN_BINDINGS.portraitAltText,
			},
			aboutSeoImage: { action: "keep-host-fallback-owner-approved" },
			aboutSeoDescription: { action: "use-host-fallback-owner-approved" },
			aboutSocial: { action: "defer-to-site-settings-owner-approved" },
			contactIntro: { action: "accept-source-plain-paragraphs-owner-approved" },
			contactStaticCopy: { action: "accept-host-seed-owner-approved" },
			contactBooking: { action: "use-host-seed-booking-owner-approved" },
			contactBookingTypes: { action: "omit-owner-approved" },
		},
	});
	const digest = await digestSanityAboutContactPlan(plan);
	const artifact: AboutContactPlanArtifact = {
		version: 1,
		operation: ABOUT_CONTACT_PLAN_OPERATION,
		sourceDigest: ABOUT_CONTACT_PLAN_BINDINGS.planSourceSha256,
		plan,
		digest,
		calls: await createCalls(plan, digest),
	};
	await parseAboutContactPlanArtifact(artifact);
	return artifact;
}

/** Revalidate the canonical plan digest and every exact operator call. */
export async function parseAboutContactPlanArtifact(
	value: unknown,
): Promise<AboutContactPlanArtifact> {
	const envelope = record(value, "About/Contact plan artifact");
	exactKeys(
		envelope,
		["version", "operation", "sourceDigest", "plan", "digest", "calls"],
		"About/Contact plan artifact",
	);
	if (
		envelope.version !== 1 ||
		envelope.operation !== ABOUT_CONTACT_PLAN_OPERATION ||
		envelope.sourceDigest !== ABOUT_CONTACT_PLAN_BINDINGS.planSourceSha256 ||
		typeof envelope.digest !== "string"
	) {
		throw new Error("About/Contact plan artifact envelope is invalid");
	}
	record(envelope.plan, "About/Contact plan");
	record(envelope.calls, "About/Contact operator calls");
	const artifact = envelope as unknown as AboutContactPlanArtifact;
	await requireSanityAboutContactPlan(artifact.plan, artifact.digest);
	const [about, contact] = artifact.plan.entries;
	if (
		about?.sourceId !== ABOUT_CONTACT_PLAN_BINDINGS.aboutSourceId ||
		about.sourceRevision !== ABOUT_CONTACT_PLAN_BINDINGS.aboutSourceRevision ||
		contact?.sourceId !== ABOUT_CONTACT_PLAN_BINDINGS.contactSourceId ||
		contact.sourceRevision !== ABOUT_CONTACT_PLAN_BINDINGS.contactSourceRevision
	) {
		throw new Error("About/Contact artifact source identities changed");
	}
	const expectedCalls = await createCalls(artifact.plan, artifact.digest);
	if (canonicalJson(artifact.calls) !== canonicalJson(expectedCalls)) {
		throw new Error("About/Contact operator calls do not match the sealed plan");
	}
	return artifact;
}

export function aboutContactCapabilityFiles(artifact: AboutContactPlanArtifact) {
	return Object.fromEntries(
		Object.entries(artifact.calls).map(([phase, call]) => [
			phase,
			`ABOUT_CONTACT_MIGRATION_CAPABILITY=${aboutContactMigrationCapabilityFor({
				siteUrl: artifact.plan.siteUrl,
				purpose: call.purpose,
				binding: call.binding,
			})}\n`,
		]),
	) as Record<keyof typeof ABOUT_CONTACT_CAPABILITY_FILES, string>;
}

export function aboutContactOperatorCommands(
	artifact: AboutContactPlanArtifact,
	artifactPath: string,
	outputDirectory: string,
) {
	const quote = (value: string) => `'${value.replaceAll("'", `'"'"'`)}'`;
	const phases = ["attest", "import", "publish"] as const;
	const lines = [
		"# Generated command shape; run from the exact deployed source revision.",
		"# Capability values stay in owner-only files and never enter shell arguments.",
		"set -eu",
		"umask 077",
		`ARTIFACT=${quote(artifactPath)}`,
		`DEPLOYMENT=${quote(ABOUT_CONTACT_PLAN_BINDINGS.deployment)}`,
		"ACTIVE=0",
		'cleanup() { if [ "$ACTIVE" -eq 1 ]; then pnpm exec convex env remove ABOUT_CONTACT_MIGRATION_CAPABILITY --deployment "$DEPLOYMENT" >/dev/null 2>&1 || true; fi; }',
		"trap cleanup EXIT HUP INT TERM",
	];
	for (const phase of phases) {
		const call = artifact.calls[phase];
		const capabilityPath = `${outputDirectory}/${ABOUT_CONTACT_CAPABILITY_FILES[phase]}`;
		lines.push(
			"",
			`# ${phase}: first call may write; the second must report identical-replay.`,
			`pnpm exec convex env set --deployment "$DEPLOYMENT" --from-file ${quote(capabilityPath)}`,
			"ACTIVE=1",
			`ARGS=$(jq -ce '.calls.${phase}.args' "$ARTIFACT")`,
			`FIRST_RESULT=$(NO_COLOR=1 pnpm exec convex run ${call.functionName} "$ARGS" --deployment "$DEPLOYMENT")`,
			'printf "%s\\n" "$FIRST_RESULT"',
			`REPLAY_RESULT=$(NO_COLOR=1 pnpm exec convex run ${call.functionName} "$ARGS" --deployment "$DEPLOYMENT")`,
			'printf "%s\\n" "$REPLAY_RESULT"',
			'printf "%s\\n" "$REPLAY_RESULT" | jq -e ".status == \\"identical-replay\\"" >/dev/null',
			'pnpm exec convex env remove ABOUT_CONTACT_MIGRATION_CAPABILITY --deployment "$DEPLOYMENT"',
			"ACTIVE=0",
			'ENV_NAMES=$(pnpm exec convex env list --names-only --deployment "$DEPLOYMENT")',
			'if printf "%s\\n" "$ENV_NAMES" | grep -Fxq ABOUT_CONTACT_MIGRATION_CAPABILITY; then',
			'  echo "ABOUT_CONTACT_MIGRATION_CAPABILITY is still present" >&2',
			"  exit 1",
			"fi",
		);
	}
	lines.push("", "trap - EXIT HUP INT TERM", "");
	return lines.join("\n");
}

export function assertPreservationOutputs(artifact: AboutContactPlanArtifact) {
	const about = artifact.plan.entries[0];
	const contact = artifact.plan.entries[1];
	if (about?.kind !== "aboutPage" || contact?.kind !== "contactPage") {
		throw new Error("About/Contact plan output pair changed");
	}
	if (
		about.payload.heading !== ANGELS_REST_ABOUT_PARITY_SEED.heading ||
		about.payload.seoDescription !== ANGELS_REST_ABOUT_PARITY_SEED.seoDescription ||
		about.payload.seoImageUrl !== undefined ||
		about.payload.biography !== undefined ||
		about.payload.portraits?.[0]?.altText !== ABOUT_CONTACT_PLAN_BINDINGS.portraitAltText ||
		contact.payload.confirmationMessage !== ANGELS_REST_CONTACT_PARITY_SEED.confirmationMessage ||
		contact.payload.bookingUrl !== ANGELS_REST_CONTACT_PARITY_SEED.bookingUrl ||
		contact.payload.bookingLabel !== ANGELS_REST_CONTACT_PARITY_SEED.bookingLabel ||
		contact.payload.bookingIntro !== ANGELS_REST_CONTACT_PARITY_SEED.bookingIntro ||
		(contact.payload.inquiryChoices?.length ?? 0) !== 0
	) {
		throw new Error("About/Contact preservation outputs changed");
	}
}
