import {
  dirname,
  extname,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
} from "node:path";

const APP_ROOT = import.meta.dirname ?? Deno.cwd();
const WEB_ROOT = join(APP_ROOT, "dist");

const MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

function isInside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

async function serveUi(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) {
    return handleApiRequest(request, url.pathname);
  }

  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  const requested = pathname === "/"
    ? "index.html"
    : pathname.replace(/^\/+/, "");
  const filePath = resolve(WEB_ROOT, requested);
  if (!isInside(WEB_ROOT, filePath)) {
    return new Response("Forbidden", { status: 403 });
  }

  try {
    const body = await Deno.readFile(filePath);
    return new Response(body, {
      headers: {
        "content-type": MIME_TYPES[extname(filePath).toLowerCase()] ??
          "application/octet-stream",
        "cache-control": pathname === "/"
          ? "no-cache"
          : "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return new Response("Not found", { status: 404 });
    }
    console.error("Failed to serve UI asset:", error);
    return new Response("Internal server error", { status: 500 });
  }
}

function jsonResponse(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

async function handleApiRequest(
  request: Request,
  pathname: string,
): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    switch (pathname) {
      case "/api/select-directory":
        return jsonResponse(await selectDirectory());
      case "/api/read-directory": {
        const body = await request.json();
        return jsonResponse(
          await readDirectoryRecursive(
            requireString(body?.dirPath, "dirPath"),
          ),
        );
      }
      case "/api/scan-paths": {
        const body = await request.json();
        return jsonResponse(
          await scanPaths(requireStringArray(body?.paths, "paths")),
        );
      }
      case "/api/rename-file":
        return jsonResponse(
          await renameFile(requireRenameRequest(await request.json())),
        );
      case "/api/quit":
        setTimeout(() => Deno.exit(0), 25);
        return jsonResponse({ success: true });
      default:
        return jsonResponse({ error: "Not found" }, 404);
    }
  } catch (error) {
    console.error(`Desktop API failed (${pathname}):`, error);
    return jsonResponse({
      error: error instanceof Error ? error.message : String(error),
    }, 400);
  }
}

async function selectDirectory(): Promise<string | null> {
  if (Deno.build.os === "darwin") {
    const command = new Deno.Command("/usr/bin/osascript", {
      args: [
        "-e",
        'POSIX path of (choose folder with prompt "选择包含剧集文件的文件夹")',
      ],
      stdout: "piped",
      stderr: "null",
    });
    const result = await command.output();
    if (!result.success) return null;
    return normalize(new TextDecoder().decode(result.stdout).trim());
  }

  if (Deno.build.os === "windows") {
    const script = [
      "Add-Type -AssemblyName System.Windows.Forms",
      "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
      "$dialog.Description = '选择包含剧集文件的文件夹'",
      "$dialog.ShowNewFolderButton = $false",
      "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {",
      "  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
      "  Write-Output $dialog.SelectedPath",
      "}",
    ].join("; ");
    const command = new Deno.Command("powershell.exe", {
      args: ["-NoProfile", "-NonInteractive", "-STA", "-Command", script],
      stdout: "piped",
      stderr: "null",
    });
    const result = await command.output();
    if (!result.success) return null;
    const selected = new TextDecoder().decode(result.stdout).trim();
    return selected ? normalize(selected) : null;
  }

  return null;
}

async function readDirectoryRecursive(dirPath: string): Promise<string[]> {
  const files: string[] = [];
  for await (const entry of Deno.readDir(dirPath)) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = join(dirPath, entry.name);
    if (entry.isDirectory) {
      files.push(...await readDirectoryRecursive(fullPath));
    } else if (entry.isFile) {
      files.push(fullPath);
    }
  }
  return files;
}

async function scanPaths(paths: string[]): Promise<string[]> {
  const files: string[] = [];
  for (const rawPath of paths) {
    const path = normalize(rawPath);
    try {
      const info = await Deno.stat(path);
      if (info.isDirectory) files.push(...await readDirectoryRecursive(path));
      else if (info.isFile) files.push(path);
    } catch (error) {
      console.error(`Failed to scan ${path}:`, error);
    }
  }
  return files;
}

async function renameFile(
  item: { oldPath: string; newPath: string },
): Promise<{ success: boolean; error?: string }> {
  const oldPath = normalize(item.oldPath);
  const newPath = normalize(item.newPath);

  if (!isAbsolute(oldPath) || !isAbsolute(newPath)) {
    return { success: false, error: "只允许使用绝对路径" };
  }
  if (dirname(oldPath) !== dirname(newPath)) {
    return { success: false, error: "新文件必须与原文件位于同一目录" };
  }

  try {
    const source = await Deno.stat(oldPath);
    if (!source.isFile) return { success: false, error: "源路径不是文件" };

    if (oldPath !== newPath) {
      try {
        await Deno.stat(newPath);
        return { success: false, error: "目标文件已存在" };
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      }
      await Deno.rename(oldPath, newPath);
    }
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${name} 必须是字符串`);
  }
  return value;
}

function requireStringArray(value: unknown, name: string): string[] {
  if (
    !Array.isArray(value) || !value.every((item) => typeof item === "string")
  ) {
    throw new TypeError(`${name} 必须是字符串数组`);
  }
  return value;
}

function requireRenameRequest(
  value: unknown,
): { oldPath: string; newPath: string } {
  if (
    typeof value !== "object" || value === null ||
    !("oldPath" in value) || !("newPath" in value)
  ) {
    throw new TypeError("重命名参数格式不正确");
  }
  return {
    oldPath: requireString(value.oldPath, "oldPath"),
    newPath: requireString(value.newPath, "newPath"),
  };
}

Deno.serve(serveUi);
