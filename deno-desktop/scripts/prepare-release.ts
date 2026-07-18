import { copyFile, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname!, "../..");
const denoRoot = join(root, "deno-desktop");
const version = JSON.parse(await Deno.readTextFile(join(root, "package.json"))).version;
const output = join(denoRoot, "artifacts", "github-release");
const prefix = `[deno-desktop]-JuRename-${version}`;
const macZip = join(output, `${prefix}-macOS-arm64.zip`);
const windowsMsi = join(output, `${prefix}-Windows-x64.msi`);

await mkdir(output, { recursive: true });
await rm(macZip, { force: true });

const command = new Deno.Command("ditto", {
  args: [
    "-c",
    "-k",
    "--sequesterRsrc",
    "--keepParent",
    join(denoRoot, "artifacts", "macos-arm64", "JuRename.app"),
    macZip,
  ],
  stdout: "inherit",
  stderr: "inherit",
});
const result = await command.output();
if (!result.success) Deno.exit(result.code);

await copyFile(
  join(denoRoot, "artifacts", "windows-x64", "JuRename.msi"),
  windowsMsi,
);

console.log(macZip);
console.log(windowsMsi);
