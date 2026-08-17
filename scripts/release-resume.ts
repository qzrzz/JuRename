/**
 * 发布流程断点续跑：根据已有产物 / Git 状态 / 本地状态文件判断下一步。
 */

export const RELEASE_STATE_FILE = ".release-state.json";

export type IReleaseBump = "patch" | "minor" | "major";

export interface IReleaseStateFile {
  version: string;
  published: boolean;
}

export interface IReleaseResolveInput {
  currentVersion: string;
  targetVersion: string;
  currentArtifactCount: number;
  targetArtifactCount: number;
  currentRemoteTag: boolean;
  targetRemoteTag: boolean;
  publishedVersion?: string;
}

export interface IReleaseResolveResult {
  action: "resume" | "bump";
  version: string;
}

/**
 * 按 patch / minor / major 计算下一个版本号
 * @param version 当前 X.Y.Z
 * @param bump 递增档位
 */
export function bumpSemver(version: string, bump: IReleaseBump): string {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) throw new Error(`无效版本号: ${version}`);
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

/**
 * 解析命令行版本参数，默认 patch
 * @param args 去掉 --publish-only 后的参数
 */
export function parseReleaseBump(args: string[]): IReleaseBump {
  const bump = args[0] ?? "patch";
  if (bump === "patch" || bump === "minor" || bump === "major") return bump;
  throw new Error(`版本参数必须是 patch / minor / major，收到: ${bump}`);
}

/**
 * 判断这一版是否还在发布中：有产物或远程 tag，且尚未完整发布成功
 * @param artifactCount 已有安装包数量
 * @param remoteTag 远程是否已有该 tag
 * @param published 该版本是否已走完 QRls
 */
export function isVersionInProgress(
  artifactCount: number,
  remoteTag: boolean,
  published: boolean,
): boolean {
  if (published) return false;
  return artifactCount > 0 || remoteTag;
}

/**
 * 决定本次是新开一版还是接着上次失败的版本跑
 * @param input 当前版本、目标版本和已有进度
 */
export function resolveReleaseAction(input: IReleaseResolveInput): IReleaseResolveResult {
  const currentPublished = input.publishedVersion === input.currentVersion;
  const targetPublished = input.publishedVersion === input.targetVersion;

  if (isVersionInProgress(input.currentArtifactCount, input.currentRemoteTag, currentPublished)) {
    return { action: "resume", version: input.currentVersion };
  }

  if (isVersionInProgress(input.targetArtifactCount, input.targetRemoteTag, targetPublished)) {
    return { action: "resume", version: input.targetVersion };
  }

  return { action: "bump", version: input.targetVersion };
}

/**
 * 读取本地发布状态文件
 * @param raw JSON 文本
 */
export function parseReleaseState(raw: string): IReleaseStateFile | undefined {
  try {
    const value = JSON.parse(raw) as Partial<IReleaseStateFile>;
    if (typeof value.version !== "string" || !value.version) return undefined;
    return { version: value.version, published: value.published === true };
  } catch {
    return undefined;
  }
}
