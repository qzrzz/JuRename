import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import started from 'electron-squirrel-startup';
import chalk from 'chalk';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 850,
    minHeight: 600,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 14, y: 14 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
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

  ipcMain.handle('rename-files', async (_event, renames: { oldPath: string, newPath: string }[]) => {
    console.log(chalk.blue(`[IPC] 收到重命名请求，共 ${renames.length} 个文件`));
    const errors: { path: string; error: string }[] = [];
    for (const item of renames) {
      try {
        await fs.rename(item.oldPath, item.newPath);
      } catch (err: any) {
        console.error(chalk.red(`[Error] 重命名失败: ${item.oldPath} -> ${item.newPath}`), err);
        errors.push({ path: item.oldPath, error: err.message });
      }
    }
    if (errors.length > 0) {
      return { success: false, errors };
    }
    console.log(chalk.green('[IPC] 批量物理重命名全部顺利完成！'));
    return { success: true };
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
