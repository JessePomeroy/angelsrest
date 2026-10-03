import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { assertReleaseRecord, createReleaseRecord, deriveReleaseStatus } from "./records.mjs";

function requireObserved(condition) {
	if (!condition) throw new Error("Release observation is incomplete or inconsistent.");
}

function digest(bytes) {
	return createHash("sha256").update(bytes).digest("hex");
}

/** Provider commands are read-only. Their output and errors never reach logs. */
function command(program, args, input) {
	try {
		return execFileSync(program, args, {
			input,
			stdio: [input ? "pipe" : "ignore", "pipe", "pipe"],
			maxBuffer: 2 * 1024 * 1024,
			timeout: 30_000,
		});
	} catch {
		throw new Error("Authenticated release observation command failed.");
	}
}

export function authenticatedReaders() {
	return {
		github: async (path, binary = false) => {
			const bytes = command("gh", ["api", "--hostname", "github.com", "--method", "GET", path]);
			return binary ? bytes : JSON.parse(bytes.toString("utf8"));
		},
		vercel: async (path) =>
			JSON.parse(command("vercel", ["api", path, "--method", "GET", "--raw"]).toString("utf8")),
		archive: (bytes) =>
			JSON.parse(
				command(
					"python3",
					[fileURLToPath(new URL("./archive.py", import.meta.url))],
					bytes,
				).toString("utf8"),
			),
	};
}

export function validateObservationTarget(target) {
	requireObserved(
		target &&
			Object.keys(target).sort().join(",") ===
				"artifactId,deploymentId,environmentId,projectId,publicOrigin,publicPaths,repository,siteUrl,target,teamId,workflow" &&
			/^[1-9]\d{0,19}$/.test(target.artifactId) &&
			/^dpl_[A-Za-z0-9]+$/.test(target.deploymentId) &&
			/^prj_[A-Za-z0-9]+$/.test(target.projectId) &&
			/^team_[A-Za-z0-9]+$/.test(target.teamId) &&
			["production", "preview", "staging"].includes(target.target) &&
			(target.environmentId !== "production" || target.target === "production") &&
			/^\.github\/workflows\/[A-Za-z0-9_-]+\.ya?ml$/.test(target.workflow),
	);
	deriveReleaseStatus([], statusTarget(target));
	return target;
}

export function statusTarget(target) {
	requireObserved(
		Array.isArray(target.publicPaths) &&
			target.publicPaths.length <= 10 &&
			new Set(target.publicPaths).size === target.publicPaths.length &&
			target.publicPaths.every(
				(path) =>
					typeof path === "string" && /^\/(?:[a-z0-9-]+\/?)*$/.test(path) && path.length <= 100,
			),
	);
	return {
		repository: target.repository,
		siteUrl: target.siteUrl,
		environmentId: target.environmentId,
		publicOrigin: target.publicOrigin,
		requiredChecks: (target.publicPaths.length ? target.publicPaths : ["/"]).map((path) => ({
			id: `http:${path}`,
			scope: "public",
		})),
	};
}

async function authenticatedBuild(target, readers) {
	const base = `/repos/${target.repository}`;
	const metadata = await readers.github(`${base}/actions/artifacts/${target.artifactId}`);
	requireObserved(
		String(metadata.id) === target.artifactId &&
			metadata.expired === false &&
			Date.parse(metadata.expires_at) > Date.now() &&
			Number.isSafeInteger(metadata.size_in_bytes) &&
			metadata.size_in_bytes > 0 &&
			metadata.size_in_bytes <= 1024 * 1024 &&
			/^sha256:[a-f0-9]{64}$/.test(metadata.digest),
	);
	const bytes = await readers.github(`${base}/actions/artifacts/${target.artifactId}/zip`, true);
	requireObserved(
		Buffer.isBuffer(bytes) &&
			bytes.length === metadata.size_in_bytes &&
			`sha256:${digest(bytes)}` === metadata.digest,
	);
	const build = assertReleaseRecord(readers.archive(bytes));
	requireObserved(
		build.kind === "build" &&
			["repository", "siteUrl", "environmentId"].every(
				(key) => build.identity[key] === target[key],
			) &&
			build.data.github.workflow === target.workflow,
	);
	const github = build.data.github;
	// Run metadata authenticates this SHA, but omits a PR's synthetic merge SHA.
	requireObserved(
		["push", "workflow_dispatch"].includes(github.event) &&
			build.data.sourceRevision === github.headSha,
	);
	const run = await readers.github(
		`${base}/actions/runs/${github.runId}/attempts/${github.runAttempt}`,
	);
	requireObserved(
		Number.isSafeInteger(run.id) &&
			run.id > 0 &&
			Number.isSafeInteger(run.repository?.id) &&
			run.repository.id > 0 &&
			String(run.id) === github.runId &&
			run.run_attempt === github.runAttempt &&
			run.status === "completed" &&
			run.conclusion === "success" &&
			run.path === github.workflow &&
			run.event === github.event &&
			run.head_sha === github.headSha &&
			run.repository?.full_name === target.repository &&
			run.head_repository?.id === run.repository.id &&
			metadata.workflow_run?.id === run.id &&
			metadata.workflow_run.repository_id === run.repository.id &&
			metadata.workflow_run.head_repository_id === run.repository.id &&
			metadata.workflow_run.head_sha === github.headSha &&
			metadata.name ===
				`release-record-${run.repository.id}-${build.data.sourceRevision}-${github.runId}-${github.runAttempt}`,
	);
	return {
		build,
		repositoryId: run.repository.id,
		artifact: {
			id: target.artifactId,
			digest: metadata.digest,
			bytes: bytes.length,
			runId: github.runId,
			runAttempt: github.runAttempt,
			url: `https://github.com/${target.repository}/actions/runs/${github.runId}/artifacts/${target.artifactId}`,
		},
	};
}

async function aliasObservation(target, readers) {
	try {
		const hostname = new URL(target.publicOrigin).hostname;
		const value = await readers.vercel(
			`/v4/aliases/${hostname}?teamId=${target.teamId}&projectId=${target.projectId}`,
		);
		requireObserved(
			value.alias === hostname &&
				value.projectId === target.projectId &&
				/^dpl_[A-Za-z0-9]+$/.test(value.deploymentId) &&
				(value.redirect === null || value.redirect === undefined) &&
				(!value.deployment || value.deployment.id === value.deploymentId),
		);
		return value.deploymentId === target.deploymentId;
	} catch {
		return null;
	}
}

/** Public reachability only; no cookies, credentials, bodies or provider effects. */
export async function publicProbe(origin, path, request = fetch) {
	try {
		const response = await request(`${origin}${path}`, {
			method: "GET",
			redirect: "manual",
			credentials: "omit",
			cache: "no-store",
			signal: AbortSignal.timeout(15_000),
		});
		await response.body?.cancel();
		const html = /^text\/html(?:;|$)/i.test(response.headers.get("content-type") ?? "");
		return {
			path,
			status: response.status,
			html,
			result:
				response.status === 200 && html
					? "passed"
					: [301, 302, 303, 307, 308, 401, 403, 429].includes(response.status)
						? "blocked"
						: "failed",
		};
	} catch {
		return { path, status: null, html: null, result: "blocked" };
	}
}

/** Dependencies are provider boundaries, allowing fully offline failure/replay tests. */
export async function observeRelease(
	target,
	readers = authenticatedReaders(),
	probe = publicProbe,
) {
	validateObservationTarget(target);
	const { build, artifact, repositoryId } = await authenticatedBuild(target, readers);
	const raw = await readers.vercel(
		`/v13/deployments/${target.deploymentId}?teamId=${target.teamId}&withGitRepoInfo=true`,
	);
	requireObserved(
		raw.id === target.deploymentId &&
			raw.ownerId === target.teamId &&
			raw.projectId === target.projectId &&
			(raw.target === null ? "preview" : raw.target) === target.target &&
			`${raw.meta?.githubCommitOrg}/${raw.meta?.githubCommitRepo}` === target.repository &&
			raw.meta.githubCommitSha === build.data.sourceRevision &&
			raw.gitSource?.type === "github" &&
			raw.gitSource.sha === build.data.sourceRevision &&
			raw.gitSource.repoId === repositoryId &&
			typeof raw.url === "string" &&
			/^[a-z0-9-]+\.vercel\.app$/.test(raw.url),
	);
	const before = await aliasObservation(target, readers);
	const probes = [];
	for (const path of target.publicPaths) {
		probes.push(
			before === true && raw.readyState === "READY"
				? await probe(target.publicOrigin, path)
				: { path, status: null, html: null, result: "blocked" },
		);
	}
	const after = probes.length ? await aliasObservation(target, readers) : before;
	const stable = before === true && after === true;
	if (!stable) for (const check of probes) check.result = "blocked";
	const observedAt = new Date().toISOString();
	const deployment = createReleaseRecord({
		kind: "deployment",
		identity: build.identity,
		observedAt,
		data: {
			buildRecordId: build.recordId,
			provider: "vercel",
			accountId: target.teamId,
			projectId: target.projectId,
			deploymentId: target.deploymentId,
			url: `https://${raw.url}`,
			target: target.target,
			status: raw.readyState,
			sourceRevision: build.data.sourceRevision,
			configFingerprint: null,
			binding: "source-only",
			aliases: [{ hostname: new URL(target.publicOrigin).hostname, assigned: after }],
		},
	});
	const receipt = {
		version: 1,
		observedAt,
		buildRecordId: build.recordId,
		deploymentRecordId: deployment.recordId,
		artifact,
		provider: {
			accountId: target.teamId,
			projectId: target.projectId,
			deploymentId: target.deploymentId,
			aliasStableDuringChecks: stable,
		},
		publicChecks: probes,
	};
	const receiptName = `observation-${digest(JSON.stringify(receipt))}.json`;
	const records = [build, deployment];
	if (probes.length) {
		records.push(
			createReleaseRecord({
				kind: "verification",
				identity: build.identity,
				observedAt,
				data: {
					deploymentRecordId: deployment.recordId,
					configFingerprint: null,
					checks: probes.map((check) => ({
						id: `http:${check.path}`,
						scope: "public",
						result: check.result,
						evidenceRef: `docs/integration-evidence/releases/${target.environmentId}/${receiptName}`,
					})),
				},
			}),
		);
	}
	deriveReleaseStatus(records, statusTarget(target));
	return { records, receipt, receiptName };
}
