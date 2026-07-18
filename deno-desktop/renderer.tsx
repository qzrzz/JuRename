/// <reference path="../src/renderer.d.ts" />
import "../src/index.css";
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "../src/renderer/App.tsx";

async function callDesktopApi<T>(path: string, body: unknown = {}): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(
      typeof result?.error === "string"
        ? result.error
        : `HTTP ${response.status}`,
    );
  }
  return result as T;
}

window.electronAPI = {
  // WebView intentionally does not expose absolute paths for dropped File objects.
  supportsPathDrop: false,
  selectFiles: () => Promise.resolve([]),
  selectDirectory: () => callDesktopApi<string | null>("/api/select-directory"),
  readDirectory: (dirPath) =>
    callDesktopApi<string[]>("/api/read-directory", { dirPath }),
  scanPaths: (paths) => callDesktopApi<string[]>("/api/scan-paths", { paths }),
  getFilePath: () => "",
  renameFile: (rename) =>
    callDesktopApi<{ success: boolean; error?: string }>(
      "/api/rename-file",
      rename,
    ),
  closeApp: () => {
    navigator.sendBeacon("/api/quit");
  },
};

const requestQuit = () => navigator.sendBeacon("/api/quit");
window.addEventListener("beforeunload", requestQuit);
window.addEventListener("pagehide", requestQuit);

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(React.createElement(App));
}
