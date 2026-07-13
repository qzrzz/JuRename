/// <reference types="vite/client" />

interface IElectronAPI {
  selectFiles: () => Promise<string[]>;
  selectDirectory: () => Promise<string | null>;
  readDirectory: (dirPath: string) => Promise<string[]>;
  scanPaths: (paths: string[]) => Promise<string[]>;
  getFilePath: (file: File) => string;
  renameFiles: (renames: { oldPath: string, newPath: string }[]) => Promise<{ success: boolean; errors?: { path: string; error: string }[] }>;
}

declare global {
  interface Window {
    electronAPI: IElectronAPI;
  }
}

export {};
