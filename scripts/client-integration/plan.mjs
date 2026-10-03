import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { contractFingerprint, getEnvironment } from "./contract.mjs";
import { inspectInventory, sourceFingerprint } from "./inventory.mjs";
import { checkPreflight } from "./preflight.mjs";

function sourceRevision(root) {
	try {
		return execFileSync("git", ["rev-parse", "--verify", "HEAD"], {
			cwd: root,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
	} catch {
		return null;
	}
}

function installedPackage(root, name, expectedVersion) {
	const consumerRequire = createRequire(resolve(root, "package.json"));
	let manifestPath;
	try {
		try {
			manifestPath = consumerRequire.resolve(`${name}/package.json`);
		} catch {
			let directory = dirname(consumerRequire.resolve(name));
			while (true) {
				const candidate = join(directory, "package.json");
				try {
					if (JSON.parse(readFileSync(candidate, "utf8")).name === name) {
						manifestPath = candidate;
						break;
					}
				} catch {
					// Entry exports often hide package.json. Inspect only their parent package metadata.
				}
				const parent = dirname(directory);
				if (parent === directory) throw new Error();
				directory = parent;
			}
		}
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
		if (
			manifest.name !== name ||
			typeof manifest.version !== "string" ||
			manifest.version.length > 100 ||
			!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(manifest.version)
		)
			throw new Error();
		return {
			name,
			expectedVersion,
			installedVersion: manifest.version,
			status: manifest.version === expectedVersion ? "matched" : "mismatch",
		};
	} catch (error) {
		return {
			name,
			expectedVersion,
			installedVersion: null,
			status: error.code === "MODULE_NOT_FOUND" ? "missing" : "unknown",
		};
	}
}

/** A reviewable local plan; remote state and changes always require a separate authorized step. */
export function createSetupPlan(contract, root, environmentId, env) {
	const environment = getEnvironment(contract, environmentId);
	const inventory = inspectInventory(contract, root);
	const preflight = checkPreflight(contract, environmentId, env);
	const packages = Object.entries(contract.packages).map(([name, version]) =>
		installedPackage(root, name, version),
	);
	const missingPackages = packages.filter(({ status }) => status !== "matched");
	const missingFiles = inventory.files.filter(({ present }) => !present);
	const missingConfiguration = preflight.checks.filter(({ status }) =>
		["missing", "invalid"].includes(status),
	);
	const proposed = [];
	if (missingFiles.length)
		proposed.push({
			kind: "files",
			description:
				"Implement the missing local routes and configuration using the declared shared contracts.",
			status: "requires-local-implementation",
		});
	if (missingPackages.length)
		proposed.push({
			kind: "packages",
			description:
				"Review and adopt the requested exact published package versions through the existing host workflow.",
			status: "requires-local-implementation",
		});
	if (missingConfiguration.length)
		proposed.push({
			kind: "configuration",
			description:
				"Review missing or mismatched settings before configuring the selected environment; preserve existing credentials and other tenants.",
			status: "requires-authorized-provisioning",
		});
	for (const kind of ["tenant", "domain", "authentication", "services"])
		proposed.push({
			kind,
			description:
				"Observe existing remote configuration first. Any required change must use its existing authorized provisioning boundary.",
			status: "requires-authorized-provisioning",
		});
	for (const [capability, { status }] of Object.entries(contract.capabilities))
		proposed.push({
			kind: capability,
			description:
				status === "included"
					? "Verify the declared tenant-scoped capability in the selected environment."
					: "Verify the excluded capability is unavailable, including any retained routes and admin controls.",
			status: "requires-verification",
		});
	return {
		version: 1,
		mode: "read-only",
		identity: {
			repository: contract.repository,
			siteUrl: contract.tenant.siteUrl,
			expectedTenantId: contract.tenant.expectedTenantId,
			environmentId: environment.id,
			sourceRevision: sourceRevision(root),
			sourceFingerprint: sourceFingerprint(root, contract),
			contractFingerprint: contractFingerprint(contract),
		},
		target: {
			publicOrigin: environment.publicOrigin,
			publicPath: environment.publicPath,
			convexUrl: environment.convexUrl,
			convexSiteUrl: environment.convexSiteUrl,
			cmsMediaOrigin: environment.cmsMediaOrigin,
			packages: { ...contract.packages },
			contracts: {
				backend: [...contract.contracts.backend],
				workers: [...contract.contracts.workers],
			},
			scope: Object.fromEntries(
				Object.entries(contract.capabilities).map(([name, { status, reason }]) => [
					name,
					{ status, reason },
				]),
			),
		},
		existing: {
			files: inventory.files.filter(({ present }) => present),
			configuration: preflight.checks.filter(({ status }) => ["present", "valid"].includes(status)),
			packages: packages.filter(({ installedVersion }) => installedVersion !== null),
		},
		missing: {
			files: missingFiles,
			configuration: missingConfiguration,
			packages: missingPackages,
			issues: [
				...inventory.issues,
				...preflight.issues,
				...missingPackages.map(({ name, status }) => `${name}: installed package is ${status}.`),
			],
		},
		proposed,
		unknown: [
			...preflight.checks
				.filter(({ status }) => status === "unknown")
				.map(
					({ service, name }) => `${service}:${name}: remote configuration has not been observed.`,
				),
			"Deployed source, configuration and backend/Worker contract availability have not been observed.",
			"Existing tenant identity, membership and domain ownership have not been observed through authenticated services.",
			"Credential validity, purpose separation and preservation of other tenants have not been established.",
			"Enabled capabilities and client-UI outcomes are not established by local file or configuration presence.",
			"Current deployment verification and final six-stage handoff evidence require separate checks.",
		],
		ready: false,
	};
}
