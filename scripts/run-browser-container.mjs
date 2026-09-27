import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { version } = require("@playwright/test/package.json");
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Expected a released Playwright version");
const root = fileURLToPath(new URL("../", import.meta.url)).replace(/\/$/, "");
const args = process.argv.slice(2);
const image = `mcr.microsoft.com/playwright:v${version}-noble`;
// The image supplies the browser's supported Linux libraries. Fixtures retain
// loopback access but cannot reach Convex, payment, email, or storage providers.
const child = spawn(
	"docker",
	[
		"run",
		"--rm",
		"--pull=never",
		"--init",
		"--network",
		"none",
		"--shm-size=1g",
		"--cap-drop=ALL",
		"--security-opt=no-new-privileges",
		...(process.getuid ? ["--user", `${process.getuid()}:${process.getgid()}`] : []),
		"--mount",
		`type=bind,src=${root},dst=${root}`,
		"--workdir",
		root,
		"--env",
		"CI=1",
		image,
		"node",
		"scripts/run-playwright.mjs",
		"--config",
		"tests/browser/playwright.config.ts",
		...(args.some((arg) => arg.startsWith("--project")) ? [] : ["--project=webkit-mobile"]),
		...args,
	],
	{ stdio: "inherit" },
);
console.log(`Browser container driver PID: ${child.pid}`);
child.on("error", (error) => {
	console.error(error.message);
	process.exitCode = 1;
});
child.on("exit", (code, signal) => {
	process.exitCode = code ?? (signal ? 1 : 0);
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
