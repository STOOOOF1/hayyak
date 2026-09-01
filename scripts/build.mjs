import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname } from "node:path";

const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");

function windowsNativeBindingWorks() {
  if (process.platform !== "win32" || process.arch !== "x64") {
    return true;
  }

  try {
    require("@next/swc-win32-x64-msvc");
    return true;
  } catch {
    return false;
  }
}

const forceWasm = process.env.HAYYAK_FORCE_SWC_WASM === "1";
const useWasm = forceWasm || !windowsNativeBindingWorks();
const args = [nextBin, "build"];
const env = { ...process.env };

if (useWasm) {
  const wasmPackage = require.resolve("@next/swc-wasm-nodejs/package.json");
  env.NEXT_TEST_WASM_DIR = dirname(wasmPackage);
  args.push("--webpack");
  console.warn(
    "Native Next.js SWC is unavailable; building with the pinned WASM/webpack fallback.",
  );
}

const result = spawnSync(process.execPath, args, {
  env,
  stdio: "inherit",
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);

