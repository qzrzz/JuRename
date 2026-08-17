/**
 * 用 QRls 把 JuRename 安装包发到 R2（主源），并可选同步到 GitHub Releases。
 * Electron 安装包不走 Sparkle，只上传各平台产物并生成 download.json。
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { qrls, type IQRlsOptions, type IQRlsVersionResult, type IVariantInput } from "qrls";

/** 与官网 `page.downloadBase` 对齐的 R2 公开前缀，末尾不含斜杠。 */
export const R2_ONLINE_URL = (
  process.env.R2_ONLINE_URL ?? "https://download.qzrzz.com/JuRename"
).replace(/\/+$/, "");

/** R2 存储桶名。凭据从环境变量或 ~/.config/qrls/qrls.config.json 读取。 */
export const R2_BUCKET = process.env.R2_BUCKET ?? "qzrzz-download";

/** R2 对象键前缀，对应公开路径 /JuRename。 */
export const R2_PATH = process.env.R2_PATH ?? "JuRename";

/** 默认同时镜像到 GitHub Release；设 PUBLISH_GITHUB=0 可只发 R2。 */
export const PUBLISH_GITHUB = process.env.PUBLISH_GITHUB !== "0";

/** GitHub 仓库，供 QRls 创建 / 更新 Release。 */
export const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY ?? "qzrzz/JuRename";

/** 当前版本必须齐备的平台变体 → 文件名。 */
export const RELEASE_VARIANT_FILES = {
  "macos-arm": (version: string) => `JuRename-${version}-arm64-mac.zip`,
  "macos-x64": (version: string) => `JuRename-${version}-x64-mac.zip`,
  "windows-x64": (version: string) => `JuRename-${version}-win.zip`,
  "linux-appimage": (version: string) => `JuRename-${version}.AppImage`,
} as const;

export type IReleaseVariantKey = keyof typeof RELEASE_VARIANT_FILES;

/**
 * 当前版本应有的安装包文件名列表
 * @param version 语义化版本
 */
export function listReleaseArtifactNames(version: string): string[] {
  return Object.values(RELEASE_VARIANT_FILES).map((fileNameOf) => fileNameOf(version));
}

/**
 * 发行目录里已经存在的当前版本安装包
 * @param releaseDir 发行产物目录
 * @param version 语义化版本
 */
export function existingReleaseArtifacts(releaseDir: string, version: string): string[] {
  return listReleaseArtifactNames(version).filter((fileName) => existsSync(join(releaseDir, fileName)));
}

/**
 * 拼接 R2 公开下载地址
 * @param fileName 对象文件名
 */
export function r2PublicUrl(fileName: string): string {
  return `${R2_ONLINE_URL}/${fileName}`;
}

/**
 * 从 release/ 收集当前版本的各平台安装包
 * @param releaseDir 发行产物目录
 * @param version 当前语义化版本
 */
export function collectReleaseVariants(
  releaseDir: string,
  version: string,
): Record<IReleaseVariantKey, IVariantInput> {
  const variants = {} as Record<IReleaseVariantKey, IVariantInput>;
  const missing: string[] = [];

  for (const [key, fileNameOf] of Object.entries(RELEASE_VARIANT_FILES)) {
    const fileName = fileNameOf(version);
    const filePath = join(releaseDir, fileName);
    if (!existsSync(filePath)) {
      missing.push(fileName);
      continue;
    }
    variants[key as IReleaseVariantKey] = { main: filePath };
  }

  if (missing.length > 0) {
    throw new Error(`缺少当前版本安装包: ${missing.join(", ")}`);
  }

  return variants;
}

/**
 * 生成写入 GitHub Release / download.json 的下载说明
 * @param version 当前语义化版本
 */
export function buildReleaseNotes(version: string): string {
  const arm = r2PublicUrl(RELEASE_VARIANT_FILES["macos-arm"](version));
  const intel = r2PublicUrl(RELEASE_VARIANT_FILES["macos-x64"](version));
  const win = r2PublicUrl(RELEASE_VARIANT_FILES["windows-x64"](version));
  const linux = r2PublicUrl(RELEASE_VARIANT_FILES["linux-appimage"](version));

  return `## 下载 JuRename

请根据你的电脑选择对应版本，点击即可下载：

- **Mac（Apple 芯片）**：[下载 macOS Apple 芯片版](${arm})（适用于 M1、M2、M3、M4 等 Apple 芯片 Mac）
- **Mac（Intel 芯片）**：[下载 macOS Intel 版](${intel})
- **Windows 用户**：[下载 Windows 版](${win})
- **Linux 用户**：[下载 Linux AppImage](${linux})

> 不知道 Mac 使用哪种芯片？点击屏幕左上角的“苹果菜单”→“关于本机”，查看“芯片”或“处理器”信息。

下载 ZIP 后解压，打开其中的 JuRename 即可使用。

---

## 本次更新`;
}

/** 一次发布需要的版本与本地产物。 */
export interface IQrlsPublishInput {
  name: string;
  version: string;
  repository: string;
  variants: Record<string, IVariantInput>;
  changelog?: string;
  force?: boolean;
  statePath?: string;
  publishGithub?: boolean;
}

/**
 * 构造 QRls 发布选项：主发 R2，可选同步 GitHub；Electron 不生成 Sparkle
 * @param input 版本与本地产物
 */
export function buildQrlsOptions(input: IQrlsPublishInput): IQRlsOptions {
  const publishGithub = input.publishGithub ?? PUBLISH_GITHUB;
  const variantKeys = Object.keys(input.variants);
  if (variantKeys.length === 0) {
    throw new Error("QRls 发布缺少安装包变体");
  }
  for (const key of variantKeys) {
    const main = input.variants[key]?.main;
    const filePath = typeof main === "string" ? main : undefined;
    if (!filePath || !existsSync(filePath)) {
      throw new Error(`QRls 发布缺少变体 ${key} 的安装包`);
    }
  }

  return {
    name: input.name,
    version: input.version,
    changelog: input.changelog,
    variants: input.variants,
    sparkle: {
      enabled: false,
    },
    historyMax: 5,
    force: input.force === true,
    statePath: input.statePath,
    verbose: true,
    target: {
      r2: {
        onlineUrl: R2_ONLINE_URL,
        bucket: R2_BUCKET,
        path: R2_PATH,
      },
      ...(publishGithub
        ? {
            github: {
              repo: input.repository,
            },
          }
        : {}),
    },
  };
}

/**
 * 调用 QRls：主发 R2，可选同步 GitHub
 * @param input 版本与本地产物
 */
export async function publishWithQrls(input: IQrlsPublishInput): Promise<IQRlsVersionResult> {
  return qrls(buildQrlsOptions(input));
}
