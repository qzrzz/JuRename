# JuRename Deno Desktop

这是 JuRename 的 Deno Desktop
版本。界面、虚拟列表与集数识别算法直接复用仓库上层的 React/TypeScript
源码，桌面端文件操作通过 `Deno.serve()` 提供的同源本地 API 暴露给 WebView。

## 要求

- Deno 2.9 或更高版本
- macOS 构建/运行时使用系统 WKWebView
- Windows 构建/运行时使用系统 WebView2

## 验证与运行

```sh
cd deno-desktop
deno task check
deno task desktop
```

`deno task desktop` 会先构建 React UI，再使用配置中的 `"backend": "webview"`
构建当前平台应用。

## 构建发行包

```sh
# macOS Apple Silicon
deno task build:macos:arm64

# macOS Intel
deno task build:macos:x64

# Windows x64 MSI
deno task build:windows:x64
```

产物写入 `artifacts/`。Deno 会自动下载并缓存对应目标平台的 runtime 与 WebView
backend。

Windows 构建建议在 Windows 主机执行，以便 Deno 在编译时把 `powershell.exe`
解析为精确的可执行文件权限。Deno 2.9.2 的 Windows 资源写入器无法读取本项目现有的
PNG 压缩帧 `.ico`，因此当前 Windows MSI 使用 Deno 默认图标；macOS 继续使用现有
`assets/icon.icns`。

## 发布到 GitHub Releases

在仓库根目录运行：

```sh
npm run release:deno-desktop
```

该命令需要已登录的 GitHub CLI，并在 macOS 上依次构建 macOS ARM64 ZIP 与
Windows x64 MSI。它使用根目录 `package.json` 的版本作为 tag；同 tag Release
已存在时更新 Deno Desktop 资产，不存在时创建 Release。GitHub 页面上的资产标签以
`[deno-desktop]` 开头。

## 平台说明

Deno Desktop 目前没有原生文件夹选择 API，因此这里分别调用 macOS 的 `osascript`
和 Windows 的 PowerShell `FolderBrowserDialog`。WebView
不会向网页暴露拖入文件的绝对路径，所以 Deno Desktop
版本只显示“打开文件夹”入口；Electron 版本仍保留拖放功能。
