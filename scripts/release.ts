#!/usr/bin/env bun

/**
 * JuRename 发布流程（每步可断点续跑）：
 * 1. 递增版本（若该版本已有产物 / tag / 状态则跳过）
 * 2. 构建三平台安装包（已有平台产物跳过）
 * 3. 提交 Git、创建并推送 tag（已存在则跳过）
 * 4. 用 QRls 发到 R2 和 GitHub（QRls 自身也有渠道级续传）
 *
 * 失败后不要回滚版本。再次 `bun run release` 会从下一未完成步骤继续。
 *
 * 用法：
 *   bun run release                 # patch，例如 1.0.0 → 1.0.1
 *   bun run release -- minor
 *   bun run release -- major
 *   bun run release -- --publish-only   # 只重试当前版本的 QRls 分发
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  GITHUB_REPOSITORY,
  PUBLISH_GITHUB,
  R2_ONLINE_URL,
  buildReleaseNotes,
  collectReleaseVariants,
  existingReleaseArtifacts,
  listReleaseArtifactNames,
  publishWithQrls,
} from "./qrls-publish";
import {
  RELEASE_STATE_FILE,
  bumpSemver,
  parseReleaseBump,
  parseReleaseState,
  resolveReleaseAction,
  type IReleaseStateFile,
} from "./release-resume";

const ROOT_DIR = join(import.meta.dirname, "..");
const STATE_PATH = join(ROOT_DIR, RELEASE_STATE_FILE);
const args = process.argv.slice(2);
const publishOnly = args.includes("--publish-only");
const bump = parseReleaseBump(args.filter((arg) => arg !== "--publish-only"));

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
const getOutput = (command: string, commandArgs: string[], options: { allowFailure?: boolean } = {}) => {
  const result = spawnSync(command, commandArgs, {
    cwd: ROOT_DIR,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    if (options.allowFailure) return "";
    if (result.stderr) process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
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
 * 读取本地发布状态（上一轮做到哪一步）
 */
const loadState = (): IReleaseStateFile | undefined => {
  if (!existsSync(STATE_PATH)) return undefined;
  return parseReleaseState(readFileSync(STATE_PATH, "utf8"));
};

/**
 * 写入本地发布状态，供下次续跑
 * @param state 当前版本与是否已分发
 */
const saveState = (state: IReleaseStateFile) => {
  writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);
};

const artifactCount = (version: string) => existingReleaseArtifacts(join(ROOT_DIR, "release"), version).length;

const hasLocalTag = (version: string) =>
  spawnSync("git", ["rev-parse", "-q", "--verify", `refs/tags/v${version}`], { cwd: ROOT_DIR }).status === 0;

const hasRemoteTag = (version: string) =>
  spawnSync("git", ["ls-remote", "--exit-code", "--tags", "origin", `refs/tags/v${version}`], {
    cwd: ROOT_DIR,
  }).status === 0;

const hasReleaseCommit = (version: string) =>
  getOutput("git", ["log", "-1", "--format=%s"], { allowFailure: true }) === `chore(release): v${version}`;

/**
 * 确保 package.json 版本与续跑目标一致（上次失败若回滚了版本，这里写回来）
 * @param version 目标版本
 */
const ensurePackageVersion = (version: string) => {
  if (readVersion() === version) return;
  run("npm", ["version", version, "--no-git-tag-version", "--allow-same-version"]);
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
  saveState({ version, published: true });
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

  const currentVersion = readVersion();
  const targetVersion = bumpSemver(currentVersion, bump);
  const state = loadState();
  const decision = resolveReleaseAction({
    currentVersion,
    targetVersion,
    currentArtifactCount: artifactCount(currentVersion),
    targetArtifactCount: artifactCount(targetVersion),
    currentRemoteTag: hasRemoteTag(currentVersion),
    targetRemoteTag: hasRemoteTag(targetVersion),
    publishedVersion: state?.published ? state.version : undefined,
  });
  const version = decision.version;

  if (decision.action === "resume") {
    console.log(`▸ 跳过升版本：继续未完成的 v${version}`);
    ensurePackageVersion(version);
    saveState({ version, published: state?.published === true && state.version === version });
  } else {
    console.log(`▸ 升版本 ${currentVersion} → ${version}（${bump}）`);
    run("npm", ["version", bump, "--no-git-tag-version"]);
    saveState({ version: readVersion(), published: false });
  }

  const missing = listReleaseArtifactNames(version).filter(
    (name) => !existingReleaseArtifacts(join(ROOT_DIR, "release"), version).includes(name),
  );
  if (missing.length === 0) {
    console.log(`▸ 跳过 dist：v${version} 四个平台产物都已存在`);
  } else {
    console.log(`▸ 执行 dist（待构建: ${missing.join(", ")}）`);
    run("bun", ["run", "dist"]);
  }

  collectReleaseVariants(join(ROOT_DIR, "release"), version);

  if (hasReleaseCommit(version)) {
    console.log(`▸ 跳过 git commit：HEAD 已是 chore(release): v${version}`);
  } else {
    console.log(`▸ git commit chore(release): v${version}`);
    run("git", ["add", "package.json", "docs"]);
    const staged = getOutput("git", ["diff", "--cached", "--name-only"]);
    if (staged) {
      run("git", ["commit", "-m", `chore(release): v${version}`]);
    } else {
      console.log("▸ 跳过 git commit：没有需要提交的版本或官网文件");
    }
  }

  if (hasLocalTag(version)) {
    console.log(`▸ 跳过 git tag：v${version} 已存在`);
  } else {
    console.log(`▸ git tag v${version}`);
    run("git", ["tag", `v${version}`]);
  }

  if (hasRemoteTag(version)) {
    console.log(`▸ 跳过 git push：origin 已有 v${version}`);
  } else {
    const branch = getOutput("git", ["branch", "--show-current"]);
    console.log(`▸ git push origin ${branch} v${version}`);
    run("git", ["push", "origin", branch, `refs/tags/v${version}`]);
  }

  const latestState = loadState();
  if (latestState?.published && latestState.version === version) {
    console.log(`▸ 跳过 QRls：v${version} 已分发`);
    return;
  }
  await publishCurrentVersion(version);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(`\n✗ ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  });
}
