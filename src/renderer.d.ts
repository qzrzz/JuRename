/// <reference types="vite/client" />

interface IElectronAPI {
  selectFiles: () => Promise<string[]>;
  selectDirectory: () => Promise<string | null>;
  readDirectory: (dirPath: string) => Promise<string[]>;
  scanPaths: (paths: string[]) => Promise<string[]>;
  getFilePath: (file: File) => string;
  renameFile: (rename: { oldPath: string; newPath: string }) => Promise<{ success: boolean; error?: string }>;
}

declare global {
  interface Window {
    electronAPI: IElectronAPI;
  }
}

export {};
