import { lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
	createReleaseRecord,
	fingerprintPublicConfig,
} from "../../packages/crm-api/src/releases/records.mjs";
import {
	assertContract,
	contractFingerprint,
	getEnvironment,
} from "../client-integration/contract.mjs";
import { resolveRepositoryFile, sourceFingerprint } from "../client-integration/inventory.mjs";
import {
	checkedOutSource,
	clientAssetsDigest,
	collectPackages,
	fileDigest,
} from "./build-inputs.mjs";

function clientContract(root) {
	const path = resolve(root, "docs/client-integration.json");
	try {
		lstatSync(path);
	} catch (error) {
		if (error.code === "ENOENT") return null;
		throw error;
	}
	const safe = resolveRepositoryFile(root, "docs/client-integration.json");
	if (!safe) throw new Error("The client contract path is unsafe.");
	return assertContract(JSON.parse(readFileSync(safe, "utf8")));
}

function workerRequirement(root, env) {
	let sourceRevision;
	try {
		sourceRevision = checkedOutSource(
			resolve(root, ".contract/gallery-worker"),
			env.RELEASE_WORKER_REVISION,
		);
	} catch {
		throw new Error(
			"The tested Worker checkout is modified or does not match its required revision.",
		);
	}
	return {
		id: "gallery-artwork-contract",
		repository: "JessePomeroy/gallery-worker",
		sourceRevision,
	};
}

/** Only explicitly named public configuration enters a record; credentials are never enumerated. */
export function observePublicConfig(env) {
	return {
		publicOrigin: env.PUBLIC_SITE_URL,
		convexUrl: env.PUBLIC_CONVEX_URL,
		convexSiteUrl: env.PUBLIC_CONVEX_SITE_URL,
		cmsMediaOrigin: env.PUBLIC_CMS_MEDIA_BASE_URL || null,
		checkoutSnapshotMode: env.CHECKOUT_SNAPSHOT_MODE || null,
		mutationTransport: "http",
	};
}

export function buildReleaseRecord(root, env) {
	const sourceRevision = checkedOutSource(root, env.GITHUB_SHA);
	const contract = clientContract(root);
	const publicConfig = observePublicConfig(env);
	const configFingerprint = fingerprintPublicConfig(publicConfig);
	const packages = collectPackages(
		root,
		undefined,
		contract ? Object.keys(contract.packages).sort() : undefined,
		contract ? [] : undefined,
	);
	const identity = {
		repository: env.GITHUB_REPOSITORY,
		siteUrl: env.RELEASE_SITE_URL,
		environmentId: env.RELEASE_ENVIRONMENT,
		contractFingerprint: contract ? contractFingerprint(contract) : null,
	};
	if (contract) {
		const environment = getEnvironment(contract, identity.environmentId);
		if (
			contract.repository !== identity.repository ||
			contract.tenant.siteUrl !== identity.siteUrl ||
			["publicOrigin", "convexUrl", "convexSiteUrl", "cmsMediaOrigin"].some(
				(key) => environment[key] !== publicConfig[key],
			) ||
			packages.some(({ name, version }) => contract.packages[name] !== version)
		)
			throw new Error("The observed build does not match its intended client contract.");
	}
	const testedWorker = workerRequirement(root, env);
	const crm = packages.find(({ name }) => name === "@jessepomeroy/crm-api");
	const backend = contract
		? contract.contracts.backend
		: [
				`crm-api@${crm.version}`,
				`commerce-intake-sha256:${fileDigest(resolve(root, "docs/contracts/commerce-intake.md"))}`,
				`platform-provisioning-sha256:${fileDigest(resolve(root, "docs/contracts/platform-client-provisioning.md"))}`,
			];
	const checks = JSON.parse(env.RELEASE_CHECKS_JSON);
	const workers = contract
		? contract.contracts.workers
				.filter((id) => id !== testedWorker.id)
				.map((id) => ({ id, repository: null, sourceRevision: null }))
		: [
				{
					id: "cms-media-editor-and-deletion",
					repository: "JessePomeroy/gallery-worker",
					sourceRevision: null,
				},
				{ id: "managed-turnstile-siteverify", repository: null, sourceRevision: null },
			];
	return createReleaseRecord({
		kind: "build",
		identity,
		observedAt: new Date().toISOString(),
		data: {
			sourceRevision,
			sourceFingerprint: contract ? sourceFingerprint(root, contract) : null,
			packages,
			lockfileDigest: fileDigest(resolve(root, "pnpm-lock.yaml")),
			scope: "ci-fixture",
			publicConfig,
			configFingerprint,
			requiredContracts: { backend, workers: [testedWorker, ...workers] },
			github: {
				runId: env.GITHUB_RUN_ID,
				runAttempt: Number(env.GITHUB_RUN_ATTEMPT),
				event: env.GITHUB_EVENT_NAME,
				ref: env.GITHUB_REF,
				headSha: env.RELEASE_HEAD_SHA,
				workflow: env.RELEASE_WORKFLOW_PATH,
			},
			checks,
			output: clientAssetsDigest(root),
		},
	});
}
