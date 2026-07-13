import { readFile } from "node:fs/promises";
import process from "node:process";
import { URL } from "node:url";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const tauriConfig = JSON.parse(await readFile(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
const cargoToml = await readFile(new URL("../src-tauri/Cargo.toml", import.meta.url), "utf8");
const cargoVersion = cargoToml.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
const versions = new Map([
  ["package.json", packageJson.version],
  ["tauri.conf.json", tauriConfig.version],
  ["Cargo.toml", cargoVersion],
]);
const expected = packageJson.version;

for (const [source, version] of versions) {
  if (version !== expected) throw new Error(`${source} version ${version ?? "missing"} does not match ${expected}`);
}

const tag = process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME : undefined;
if (tag && tag !== `v${expected}`) throw new Error(`Git tag ${tag} does not match v${expected}`);

process.stdout.write(`Version ${expected} is consistent\n`);
