import { contextBridge, ipcRenderer, webUtils } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  selectFiles: () => ipcRenderer.invoke('select-files'),
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  readDirectory: (dirPath: string) => ipcRenderer.invoke('read-directory', dirPath),
  scanPaths: (paths: string[]) => ipcRenderer.invoke('scan-paths', paths),
  getFilePath: (file: File) => webUtils.getPathForFile(file),
  renameFiles: (renames: { oldPath: string, newPath: string }[]) => ipcRenderer.invoke('rename-files', renames)
});
