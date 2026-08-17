import { bumpSemver, parseReleaseBump, resolveReleaseAction } from "../release-resume";
import { stripLinkDependencies } from "../strip-link-deps.mjs";

describe("发布断点续跑", () => {
  test("bumpSemver 按档位递增", () => {
    expect(bumpSemver("1.2.4", "patch")).toBe("1.2.5");
    expect(bumpSemver("1.2.4", "minor")).toBe("1.3.0");
    expect(bumpSemver("1.2.4", "major")).toBe("2.0.0");
  });

  test("parseReleaseBump 默认 patch，拒绝未知参数", () => {
    expect(parseReleaseBump([])).toBe("patch");
    expect(parseReleaseBump(["minor"])).toBe("minor");
    expect(() => parseReleaseBump(["1.2.5"])).toThrow(/patch \/ minor \/ major/);
  });

  test("全新发布：当前版没有产物，目标版也没有，则递增版本", () => {
    expect(
      resolveReleaseAction({
        currentVersion: "1.2.4",
        targetVersion: "1.2.5",
        currentArtifactCount: 0,
        targetArtifactCount: 0,
        currentRemoteTag: false,
        targetRemoteTag: false,
      }),
    ).toEqual({ action: "bump", version: "1.2.5" });
  });

  test("dist 做到一半：package.json 已是新版本，接着跑同一版", () => {
    expect(
      resolveReleaseAction({
        currentVersion: "1.2.5",
        targetVersion: "1.2.6",
        currentArtifactCount: 2,
        targetArtifactCount: 0,
        currentRemoteTag: false,
        targetRemoteTag: false,
      }),
    ).toEqual({ action: "resume", version: "1.2.5" });
  });

  test("失败后回滚了 package.json：按目标版已有产物恢复续跑", () => {
    expect(
      resolveReleaseAction({
        currentVersion: "1.2.4",
        targetVersion: "1.2.5",
        currentArtifactCount: 0,
        targetArtifactCount: 2,
        currentRemoteTag: false,
        targetRemoteTag: false,
      }),
    ).toEqual({ action: "resume", version: "1.2.5" });
  });

  test("Git 已推送但 QRls 未完成：继续同一版，不递增", () => {
    expect(
      resolveReleaseAction({
        currentVersion: "1.2.5",
        targetVersion: "1.2.6",
        currentArtifactCount: 4,
        targetArtifactCount: 0,
        currentRemoteTag: true,
        targetRemoteTag: false,
      }),
    ).toEqual({ action: "resume", version: "1.2.5" });
  });

  test("上一版已经完整发布：再执行 release 才递增新版本", () => {
    expect(
      resolveReleaseAction({
        currentVersion: "1.2.5",
        targetVersion: "1.2.6",
        currentArtifactCount: 4,
        targetArtifactCount: 0,
        currentRemoteTag: true,
        targetRemoteTag: false,
        publishedVersion: "1.2.5",
      }),
    ).toEqual({ action: "bump", version: "1.2.6" });
  });
});

describe("Docker 打包前去掉 link 依赖", () => {
  test("删除 link:/file:/workspace: 规格，保留普通依赖", () => {
    const stripped = stripLinkDependencies({
      name: "jurename",
      version: "1.2.5",
      dependencies: {
        react: "19.2.7",
      },
      devDependencies: {
        electron: "43.1.0",
        qpage: "link:qpage",
        qrls: "link:qrls",
        local: "file:../other",
      },
    });

    expect(stripped.dependencies).toEqual({ react: "19.2.7" });
    expect(stripped.devDependencies).toEqual({ electron: "43.1.0" });
  });
});
