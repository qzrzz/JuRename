import { contextBridge, ipcRenderer, webUtils } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  supportsPathDrop: true,
  selectFiles: () => ipcRenderer.invoke('select-files'),
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  readDirectory: (dirPath: string) => ipcRenderer.invoke('read-directory', dirPath),
  readDirectoryFlat: (dirPath: string) => ipcRenderer.invoke('read-directory-flat', dirPath),
  inspectDirectory: (dirPath: string) => ipcRenderer.invoke('inspect-directory', dirPath),
  scanPaths: (paths: string[]) => ipcRenderer.invoke('scan-paths', paths),
  getFilePath: (file: File) => webUtils.getPathForFile(file),
  renameFile: (rename: { oldPath: string, newPath: string }) => ipcRenderer.invoke('rename-file', rename),
  showItemInFolder: (itemPath: string) => ipcRenderer.invoke('show-item-in-folder', itemPath),
  exportTestSamples: (samples: Array<[number | null, string]>, fileName: string) =>
    ipcRenderer.invoke('export-test-samples', { samples, fileName }),
});
