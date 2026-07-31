import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import chalk from 'chalk';

const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 850,
    minHeight: 600,
    icon: app.isPackaged
      ? path.join(process.resourcesPath, 'icon.png')
      : path.join(process.cwd(), 'icon.png'),
    // Chromium may expose the native window surface for a frame while macOS
    // performs a live resize. Keep that surface the same colour as the app.
    backgroundColor: '#0a0d0c',
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 14, y: 14 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // and load the index.html of the app.
  if (!app.isPackaged) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'));
  }
};

// 递归读取目录中的所有非隐藏文件
async function readDirectoryRecursive(dirPath: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (!entry.name.startsWith('.')) {
        const subFiles = await readDirectoryRecursive(fullPath);
        files.push(...subFiles);
      }
    } else if (entry.isFile()) {
      if (!entry.name.startsWith('.')) {
        files.push(fullPath);
      }
    }
  }
  return files;
}

// 读取目录中第一层的直接文件（不递归，只保留文件）
async function readDirectoryFlat(dirPath: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && !entry.name.startsWith('.')) {
      files.push(path.join(dirPath, entry.name));
    }
  }
  return files;
}

// 检查目录直属第一层的子文件夹和子文件
async function inspectDirectory(dirPath: string): Promise<{
  subDirs: { name: string; path: string }[];
  subFiles: { name: string; path: string }[];
}> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const subDirs: { name: string; path: string }[] = [];
  const subFiles: { name: string; path: string }[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      subDirs.push({ name: entry.name, path: fullPath });
    } else if (entry.isFile()) {
      subFiles.push({ name: entry.name, path: fullPath });
    }
  }
  return { subDirs, subFiles };
}

// 注册 IPC 句柄
function registerIpcHandlers() {
  ipcMain.handle('select-files', async () => {
    console.log(chalk.cyan('[IPC] 收到文件选择请求'));
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Media Files', extensions: ['mp4', 'mkv', 'avi', 'mov', 'flv', 'ts', 'webm', 'wmv', 'mp3', 'wav', 'flac'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });
    return result.filePaths;
  });

  ipcMain.handle('select-directory', async () => {
    console.log(chalk.cyan('[IPC] 收到目录选择请求'));
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory']
    });
    return result.filePaths[0] || null;
  });

  ipcMain.handle('read-directory', async (_event, dirPath: string) => {
    console.log(chalk.cyan(`[IPC] 递归读取目录内容: ${dirPath}`));
    try {
      const files = await readDirectoryRecursive(dirPath);
      console.log(chalk.green(`[IPC] 读取完成，共找到 ${files.length} 个文件`));
      return files;
    } catch (err: any) {
      console.error(chalk.red(`[Error] 读取目录失败 ${dirPath}:`), err);
      throw err;
    }
  });

  ipcMain.handle('read-directory-flat', async (_event, dirPath: string) => {
    console.log(chalk.cyan(`[IPC] 读取直属一级文件: ${dirPath}`));
    try {
      const files = await readDirectoryFlat(dirPath);
      console.log(chalk.green(`[IPC] 读取完成，共找到 ${files.length} 个一级文件`));
      return files;
    } catch (err: any) {
      console.error(chalk.red(`[Error] 读取一级文件失败 ${dirPath}:`), err);
      throw err;
    }
  });

  ipcMain.handle('inspect-directory', async (_event, dirPath: string) => {
    console.log(chalk.cyan(`[IPC] 检查目录直属项: ${dirPath}`));
    try {
      const result = await inspectDirectory(dirPath);
      console.log(chalk.green(`[IPC] 检查完成，子文件夹: ${result.subDirs.length}，子文件: ${result.subFiles.length}`));
      return result;
    } catch (err: any) {
      console.error(chalk.red(`[Error] 检查目录失败 ${dirPath}:`), err);
      throw err;
    }
  });

  ipcMain.handle('scan-paths', async (_event, paths: string[]) => {
    console.log(chalk.cyan(`[IPC] 收到路径扫描请求，共 ${paths.length} 个根路径`));
    const allFiles: string[] = [];
    for (const p of paths) {
      try {
        const stat = await fs.stat(p);
        if (stat.isDirectory()) {
          const subFiles = await readDirectoryRecursive(p);
          allFiles.push(...subFiles);
        } else if (stat.isFile()) {
          allFiles.push(p);
        }
      } catch (err: any) {
        console.error(chalk.red(`[Error] 扫描路径出错: ${p}`), err);
      }
    }
    console.log(chalk.green(`[IPC] 路径扫描完成，展开后共 ${allFiles.length} 个文件`));
    return allFiles;
  });

  ipcMain.handle('rename-file', async (_event, item: { oldPath: string, newPath: string }) => {
    try {
      if (item.oldPath !== item.newPath) {
        try {
          await fs.access(item.newPath);
          return { success: false, error: '目标文件已存在' };
        } catch (error: any) {
          if (error?.code !== 'ENOENT') {
            return { success: false, error: error?.message || '无法检查目标文件' };
          }
        }
      }
      await fs.rename(item.oldPath, item.newPath);
      return { success: true };
    } catch (err: any) {
      console.error(chalk.red(`[Error] 重命名失败: ${item.oldPath} -> ${item.newPath}`), err);
      return { success: false, error: err.message || String(err) };
    }
  });
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
app.on('ready', () => {
  registerIpcHandlers();
  createWindow();
});

// Quit when all windows are closed, except on macOS.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
