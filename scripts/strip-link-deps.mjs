import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const LINK_SPEC = /^(link|file|workspace):/;

/**
 * 去掉 npm 无法安装的 link:/file:/workspace: 依赖（Docker 打包用不着用 qpage / qrls）
 * @param {Record<string, unknown>} pkg package.json 对象
 */
export function stripLinkDependencies(pkg) {
  const next = structuredClone(pkg);
  for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    const deps = next[field];
    if (!deps || typeof deps !== "object") continue;
    for (const [name, spec] of Object.entries(deps)) {
      if (LINK_SPEC.test(String(spec))) delete deps[name];
    }
    if (Object.keys(deps).length === 0) delete next[field];
  }
  return next;
}

const invokedAsScript = Boolean(process.argv[1])
  && pathToFileURL(process.argv[1]).href === import.meta.url;

if (invokedAsScript) {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  writeFileSync("package.json", `${JSON.stringify(stripLinkDependencies(pkg), null, 2)}\n`);
}
