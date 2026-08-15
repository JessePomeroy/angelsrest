import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
	createSanityBlogReconciliationArtifact,
	parseSanityBlogReconciliationPlanInput,
} from "./sanityBlogReconciliationPlan";

function options(args: string[]) {
	let inputPath: string | undefined;
	let outputPath: string | undefined;
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--") continue;
		if (arg === "--input") inputPath = args[++index];
		else if (arg === "--out") outputPath = args[++index];
		else throw new Error(`Unsupported argument: ${arg}`);
	}
	if (!inputPath || !outputPath) {
		throw new Error("Usage: --input <reviewed.json> --out <plan.json>");
	}
	return { inputPath: resolve(inputPath), outputPath: resolve(outputPath) };
}

async function main() {
	const paths = options(process.argv.slice(2));
	const input = parseSanityBlogReconciliationPlanInput(
		JSON.parse(await readFile(paths.inputPath, "utf8")) as unknown,
	);
	const artifact = await createSanityBlogReconciliationArtifact(input);
	await writeFile(paths.outputPath, `${JSON.stringify(artifact, null, 2)}\n`, {
		flag: "wx",
		mode: 0o600,
	});
	console.log(artifact.digest);
}

void main().catch((error) => {
	console.error(error instanceof Error ? error.message : "Reconciliation planning failed");
	process.exitCode = 1;
});
