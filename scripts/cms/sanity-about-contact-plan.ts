import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
	ABOUT_CONTACT_CAPABILITY_FILES,
	ABOUT_CONTACT_COMMANDS_FILE,
	ABOUT_CONTACT_PLAN_BINDINGS,
	ABOUT_CONTACT_PLAN_FILE,
	type AboutContactPlanArtifact,
	aboutContactCapabilityFiles,
	aboutContactOperatorCommands,
	assertPreservationOutputs,
	createAboutContactPlanArtifact,
	parseAboutContactPlanSource,
} from "./sanityAboutContactPlanOperator";

type Options = {
	sourceFile: string;
	portraitReceiptFile: string;
	outputDirectory: string;
};

export const ABOUT_CONTACT_PLAN_USAGE = `Usage:
  pnpm cms:about-contact-plan -- \\
    --source-file /absolute/path/to/plan-source.json \\
    --portrait-receipt-file /absolute/path/to/about-contact-portrait-transfer-receipt.json \\
    --output-dir /absolute/path/to/new-owner-only-directory

Extract the exact embedded planSource without a trailing newline:
  umask 077
  jq -j -cS '.planSource' "$SEALED_INVENTORY" > "$PLAN_SOURCE"`;

function serialize(value: unknown) {
	return `${JSON.stringify(value, null, "\t")}\n`;
}

function parseOptions(args: readonly string[]): Options {
	const values = new Map<string, string>();
	const accepted = new Set(["--source-file", "--portrait-receipt-file", "--output-dir"]);
	for (let index = 0; index < args.length; index += 1) {
		const name = args[index];
		if (name === "--") continue;
		if (!name || !accepted.has(name)) throw new Error(`Unsupported argument: ${name}`);
		if (values.has(name)) throw new Error(`${name} may only be supplied once`);
		const value = args[index + 1];
		if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
		values.set(name, value);
		index += 1;
	}
	const sourceFile = values.get("--source-file");
	const portraitReceiptFile = values.get("--portrait-receipt-file");
	const outputDirectory = values.get("--output-dir");
	for (const [value, label] of [
		[sourceFile, "--source-file"],
		[portraitReceiptFile, "--portrait-receipt-file"],
		[outputDirectory, "--output-dir"],
	] as const) {
		if (!value || value !== value.trim() || !isAbsolute(value)) {
			throw new Error(`${label} requires one absolute path`);
		}
	}
	return { sourceFile, portraitReceiptFile, outputDirectory };
}

async function readOwnerOnlyJson(path: string, label: string) {
	let handle: Awaited<ReturnType<typeof open>>;
	try {
		handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
	} catch {
		throw new Error(`${label} must be an owner-only regular file`);
	}
	try {
		const stats = await handle.stat();
		if (!stats.isFile() || (stats.mode & 0o077) !== 0) {
			throw new Error(`${label} must be an owner-only regular file`);
		}
		if (typeof process.getuid === "function" && stats.uid !== process.getuid()) {
			throw new Error(`${label} must be owned by the current operator`);
		}
		const bytes = await handle.readFile();
		return {
			value: JSON.parse(bytes.toString("utf8")) as unknown,
			bytes,
		};
	} finally {
		await handle.close();
	}
}

export function assertExactAboutContactPlanSourceBytes(bytes: Uint8Array) {
	if (
		createHash("sha256").update(bytes).digest("hex") !==
		ABOUT_CONTACT_PLAN_BINDINGS.planSourceSha256
	) {
		throw new Error("About/Contact source file is not the byte-identical sealed planSource");
	}
}

async function writePrivateFile(path: string, contents: string) {
	const handle = await open(path, "wx", 0o600);
	try {
		await handle.writeFile(contents, "utf8");
		await handle.sync();
	} finally {
		await handle.close();
	}
}

async function syncDirectory(path: string) {
	const handle = await open(path, "r");
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
}

export async function writeAboutContactPlanBundle(
	outputDirectory: string,
	artifact: AboutContactPlanArtifact,
) {
	await mkdir(outputDirectory, { mode: 0o700 });
	const stats = await lstat(outputDirectory);
	if (!stats.isDirectory() || stats.isSymbolicLink() || (stats.mode & 0o077) !== 0) {
		throw new Error("Output directory must be a new owner-only directory");
	}
	if (typeof process.getuid === "function" && stats.uid !== process.getuid()) {
		throw new Error("Output directory must be owned by the current operator");
	}
	const artifactPath = resolve(outputDirectory, ABOUT_CONTACT_PLAN_FILE);
	const capabilities = aboutContactCapabilityFiles(artifact);
	await writePrivateFile(artifactPath, serialize(artifact));
	for (const phase of ["attest", "import", "publish"] as const) {
		await writePrivateFile(
			resolve(outputDirectory, ABOUT_CONTACT_CAPABILITY_FILES[phase]),
			capabilities[phase],
		);
	}
	await writePrivateFile(
		resolve(outputDirectory, ABOUT_CONTACT_COMMANDS_FILE),
		aboutContactOperatorCommands(artifact, artifactPath, outputDirectory),
	);
	await syncDirectory(outputDirectory);
	return artifactPath;
}

async function main() {
	if (process.argv.slice(2).includes("--help")) {
		console.log(ABOUT_CONTACT_PLAN_USAGE);
		return;
	}
	const options = parseOptions(process.argv.slice(2));
	const [sourceFile, portraitReceiptFile] = await Promise.all([
		readOwnerOnlyJson(options.sourceFile, "About/Contact source file"),
		readOwnerOnlyJson(options.portraitReceiptFile, "About portrait receipt file"),
	]);
	assertExactAboutContactPlanSourceBytes(sourceFile.bytes);
	const artifact = await createAboutContactPlanArtifact(
		parseAboutContactPlanSource(sourceFile.value),
		portraitReceiptFile.value,
	);
	assertPreservationOutputs(artifact);
	const artifactPath = await writeAboutContactPlanBundle(options.outputDirectory, artifact);
	console.log(`Sealed About/Contact plan: ${artifactPath}`);
	console.log(`Plan digest: ${artifact.digest}`);
	console.log(
		`Operator commands: ${resolve(options.outputDirectory, ABOUT_CONTACT_COMMANDS_FILE)}`,
	);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : String(error));
		console.error(ABOUT_CONTACT_PLAN_USAGE);
		process.exitCode = 1;
	});
}
