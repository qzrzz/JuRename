# JuRename

JuRename 是一个用于剧集、播客和有声书的批量重命名工具。它从杂乱的文件名中识别连续序号，将补零后的序号添加到文件名开头，让播放器按正确顺序排列。

![JuRename 主界面](./website/pic/截屏01.png)

- [产品主页](https://qzrzz.github.io/JuRename/)
- [下载最新版](https://github.com/qzrzz/JuRename/releases)

## 功能

- 拖入文件或文件夹，也可以通过文件选择器添加
- 根据整批文件中的连续数字识别序号，不依赖“集”或“EP”等关键词
- 排除年份、分辨率和标题数字等干扰项
- 支持缺集提示、补零位数和分隔符设置
- 重命名前预览结果，并可单独取消文件
- 支持 `001.1` 一类子序号

例如：

```text
A剧略略略-01.m4a          → 01-A剧略略略-01.m4a
A剧 2021 略 7 略-02.m4a  → 02-A剧 2021 略 7 略-02.m4a
特殊A剧略略略 3.m4a      → 03-特殊A剧略略略 3.m4a
A剧咯咯咯-4 (2).m4a      → 04-A剧咯咯咯-4 (2).m4a
```

> 批量重命名不可撤销。执行前请检查预览结果，重要文件建议先备份。

## 开发

环境要求：

- [Bun](https://bun.sh/)
- Node.js 22.12 或更高版本

安装依赖并启动 Electron 开发环境：

```bash
bun install
bun run start
```

常用命令：

| 命令 | 用途 |
| --- | --- |
| `bun run start` | 构建主进程和 preload，启动渲染进程开发服务器与 Electron |
| `bun run check` | 运行 TypeScript 检查和单元测试 |
| `bun run test` | 只运行单元测试 |
| `bun run build` | 构建 Electron 的主进程、preload 和渲染进程 |
| `bun run website:dev` | 启动官网开发服务器 |
| `bun run website:build` | 构建官网到 `docs/` |
| `bun run dist` | 构建 macOS、Windows 和 Linux 发行包 |
| `bun run release` | 递增版本并发布新的 GitHub Release |

主进程、preload 和各平台打包步骤由 `scripts/` 中的内部脚本处理，不再暴露为 npm scripts。

### 项目结构

```text
src/core/       序号识别逻辑与回归样例
src/renderer/   Electron 界面
src/main.ts     Electron 主进程
src/preload.ts  主进程与界面的安全桥接
website/        官网源码
scripts/        开发、打包和发布脚本
```

## 测试样例

回归样例位于 `src/core/test/sample/`。每个 `.txt` 文件都会被测试自动加载，每行格式为：

```text
期望序号<TAB>原始文件名
```

以 `#` 开头的行是说明或不参与识别的文件名。新增问题样例后运行：

```bash
bun run test
```

## 打包与发布

### `build`、`dist` 和 `release` 的区别

| 命令 | 用途 | 产物或结果 |
| --- | --- | --- |
| `bun run build` | 编译 Electron 的主进程、preload 和渲染进程 | 生成 `dist-electron/`，用于检查构建或供后续打包使用，不能直接作为安装包发布 |
| `bun run dist` | 执行 `build`，然后打包 macOS、Windows 和 Linux 版本 | 在 `release/` 中生成 DMG、ZIP、AppImage 等发行文件，并完成 macOS 签名与公证 |
| `bun run release` | 执行完整的新版本发布流程 | 更新版本、构建官网、执行 `dist`、提交 Git、创建并推送 tag，最后创建 GitHub Release |

三者是逐层包含的关系：

```text
release
├── 更新版本并构建官网
├── dist
│   └── build
├── Git commit、tag 和 push
└── GitHub Release
```

日常开发验证使用 `build`，需要本地安装包时使用 `dist`，只有正式发布新版本时才使用 `release`。

`dist` 会在本机完成 macOS 签名与公证，并通过 Docker 构建 Windows 和 Linux 包。Docker 需要至少分配 5 GiB 内存，所有产物输出到 `release/`。

打包支持断点续跑：重新执行 `dist` 或失败后的 `release` 时，当前版本已经生成的各平台产物会被跳过，只构建缺失的平台。旧版本产物不会被当作当前版本，也不会上传到新的 GitHub Release。

在 `.env` 中配置 macOS 签名与公证信息：

```dotenv
MACOS_SIGNING_IDENTITY='Developer ID Application: Your Name (TEAMID)'
APPLE_ID='you@example.com'
APPLE_APP_SPECIFIC_PASSWORD='xxxx-xxxx-xxxx-xxxx'
APPLE_TEAM_ID='TEAMID'
```

发布前还需要安装并登录 [GitHub CLI](https://cli.github.com/)：

```bash
gh auth login
```

发布脚本要求 Git 工作区干净。它会更新版本、构建官网和三平台安装包、提交、创建并推送 Git tag，最后创建 GitHub Release：

```bash
bun run release           # patch，例如 1.0.0 → 1.0.1
bun run release -- minor  # minor，例如 1.0.0 → 1.1.0
bun run release -- major  # major，例如 1.0.0 → 2.0.0
```
