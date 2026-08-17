import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  R2_ONLINE_URL,
  RELEASE_VARIANT_FILES,
  buildQrlsOptions,
  buildReleaseNotes,
  collectReleaseVariants,
  existingReleaseArtifacts,
  r2PublicUrl,
} from "../qrls-publish";

function writeReleaseArtifacts(version: string): string {
  const dir = mkdtempSync(join(tmpdir(), "jurename-qrls-"));
  for (const fileNameOf of Object.values(RELEASE_VARIANT_FILES)) {
    writeFileSync(join(dir, fileNameOf(version)), "artifact");
  }
  return dir;
}

describe("QRls 发布辅助", () => {
  test("r2PublicUrl 使用官网 downloadBase 前缀", () => {
    expect(r2PublicUrl("download.json")).toBe(`${R2_ONLINE_URL}/download.json`);
    expect(R2_ONLINE_URL).toBe("https://download.qzrzz.com/JuRename");
  });

  test("collectReleaseVariants 按平台收集当前版本安装包", () => {
    const version = "1.2.5";
    const dir = writeReleaseArtifacts(version);
    const variants = collectReleaseVariants(dir, version);

    expect(Object.keys(variants)).toEqual([
      "macos-arm",
      "macos-x64",
      "windows-x64",
      "linux-appimage",
    ]);
    expect(variants["macos-arm"].main).toBe(join(dir, `JuRename-${version}-arm64-mac.zip`));
    expect(variants["windows-x64"].main).toBe(join(dir, `JuRename-${version}-win.zip`));
  });

  test("existingReleaseArtifacts 只统计当前版本已有的包", () => {
    const version = "1.2.5";
    const dir = mkdtempSync(join(tmpdir(), "jurename-qrls-partial-"));
    writeFileSync(join(dir, `JuRename-${version}-arm64-mac.zip`), "artifact");
    writeFileSync(join(dir, `JuRename-${version}-x64-mac.zip`), "artifact");
    expect(existingReleaseArtifacts(dir, version)).toEqual([
      `JuRename-${version}-arm64-mac.zip`,
      `JuRename-${version}-x64-mac.zip`,
    ]);
    expect(existingReleaseArtifacts(dir, "1.2.4")).toEqual([]);
  });

  test("缺少任一平台产物时拒绝发布", () => {
    const dir = mkdtempSync(join(tmpdir(), "jurename-qrls-missing-"));
    writeFileSync(join(dir, "JuRename-1.2.5-arm64-mac.zip"), "artifact");
    expect(() => collectReleaseVariants(dir, "1.2.5")).toThrow(/JuRename-1.2.5-x64-mac.zip/);
  });

  test("buildQrlsOptions 主发 R2 并镜像 GitHub，且关闭 Sparkle", () => {
    const version = "1.2.5";
    const dir = writeReleaseArtifacts(version);
    const options = buildQrlsOptions({
      name: "JuRename",
      version,
      repository: "qzrzz/JuRename",
      variants: collectReleaseVariants(dir, version),
      publishGithub: true,
    });

    expect(options.sparkle).toEqual({ enabled: false });
    expect(options.target.r2).toMatchObject({
      onlineUrl: "https://download.qzrzz.com/JuRename",
      bucket: "qzrzz-download",
      path: "JuRename",
    });
    expect(options.target.github).toEqual({ repo: "qzrzz/JuRename" });
    expect(Object.keys(options.variants)).toHaveLength(4);
  });

  test("PUBLISH_GITHUB=0 时只发 R2", () => {
    const version = "1.2.5";
    const dir = writeReleaseArtifacts(version);
    const options = buildQrlsOptions({
      name: "JuRename",
      version,
      repository: "qzrzz/JuRename",
      variants: collectReleaseVariants(dir, version),
      publishGithub: false,
    });

    expect(options.target.github).toBeUndefined();
    expect(options.target.r2).toBeDefined();
  });

  test("下载说明使用 R2 直链", () => {
    const notes = buildReleaseNotes("1.2.5");
    expect(notes).toContain("https://download.qzrzz.com/JuRename/JuRename-1.2.5-arm64-mac.zip");
    expect(notes).toContain("https://download.qzrzz.com/JuRename/JuRename-1.2.5-win.zip");
    expect(notes).not.toContain("github.com/qzrzz/JuRename/releases/download");
  });
});
