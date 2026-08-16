#!/usr/bin/env bun

/**
 * JuRename 发布流程：
 * 1. 递增版本并构建官网、三平台安装包
 * 2. 提交 Git、创建并推送 tag
 * 3. 用 QRls 把安装包发到 R2（主源）和 GitHub Releases
 *
 * 用法：
 *   bun run release                 # patch，例如 1.0.0 → 1.0.1
 *   bun run release -- minor
 *   bun run release -- major
 *   bun run release -- --publish-only   # 只重试当前版本的 QRls 分发
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  GITHUB_REPOSITORY,
  PUBLISH_GITHUB,
  R2_ONLINE_URL,
  buildReleaseNotes,
  collectReleaseVariants,
  publishWithQrls,
} from "./qrls-publish";

const ROOT_DIR = join(import.meta.dirname, "..");
const args = process.argv.slice(2);
const publishOnly = args.includes("--publish-only");
const versionBump = args.filter((arg) => arg !== "--publish-only");
const bumpArgs = versionBump.length === 0 ? ["patch"] : versionBump;

/**
 * 在仓库根目录执行命令，失败则抛出
 * @param command 可执行文件
 * @param commandArgs 参数
 */
const run = (command: string, commandArgs: string[]) => {
  const result = spawnSync(command, commandArgs, {
    cwd: ROOT_DIR,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`${command} was terminated by ${result.signal}.`);
  if (result.status !== 0) throw new Error(`${command} exited with code ${result.status ?? 1}.`);
};

/**
 * 执行命令并返回 stdout
 * @param command 可执行文件
 * @param commandArgs 参数
 */
const getOutput = (command: string, commandArgs: string[]) => {
  const result = spawnSync(command, commandArgs, {
    cwd: ROOT_DIR,
    encoding: "utf8",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
  return result.stdout.trim();
};

const readVersion = () => {
  const packageJson = JSON.parse(readFileSync(join(ROOT_DIR, "package.json"), "utf8")) as {
    version?: string;
  };
  if (typeof packageJson.version !== "string" || !packageJson.version) {
    throw new Error("package.json must contain a version.");
  }
  return packageJson.version;
};

/**
 * 用 QRls 上传当前版本安装包
 * @param version 当前语义化版本
 */
const publishCurrentVersion = async (version: string) => {
  const variants = collectReleaseVariants(join(ROOT_DIR, "release"), version);
  const changelog = buildReleaseNotes(version);
  console.log(`▸ 用 QRls 发布 v${version} 到 R2（${R2_ONLINE_URL}）…`);
  const result = await publishWithQrls({
    name: "JuRename",
    version,
    repository: GITHUB_REPOSITORY,
    variants,
    changelog,
    statePath: join(ROOT_DIR, ".qrls-state.json"),
  });
  console.log(`✓ QRls 已发布: v${version}`);
  if (result.r2) {
    console.log(`  R2: ${R2_ONLINE_URL}/download.json`);
  }
  if (PUBLISH_GITHUB && result.github) {
    console.log(`  GitHub: https://github.com/${GITHUB_REPOSITORY}/releases/tag/v${version}`);
  }
};

async function main() {
  if (publishOnly) {
    await publishCurrentVersion(readVersion());
    return;
  }

 
  run("node", ["scripts/build-all-platforms.mjs", "--check"]);
  const originalPackageJson = readFileSync(join(ROOT_DIR, "package.json"), "utf8");
  try {
    run("npm", ["version", ...bumpArgs, "--no-git-tag-version"]);
    run("bun", ["run", "dist"]);
  } catch (error) {
    writeFileSync(join(ROOT_DIR, "package.json"), originalPackageJson);
    throw error;
  }

  const version = readVersion();
  collectReleaseVariants(join(ROOT_DIR, "release"), version);

  run("git", ["add", "package.json", "docs"]);
  run("git", ["commit", "-m", `chore(release): v${version}`]);
  run("git", ["tag", `v${version}`]);
  const branch = getOutput("git", ["branch", "--show-current"]);
  run("git", ["push", "origin", branch, `refs/tags/v${version}`]);

  await publishCurrentVersion(version);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(`\n✗ ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  });
}
