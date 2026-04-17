# html2exe

html2exe 是一个基于 Electron 的可视化打包器，用来把 Electron 项目或纯 HTML 目录快速打成桌面安装包。

它的设计目标是：

- 降低 electron-builder 的使用门槛（图形化参数配置）。
- 让纯 HTML 目录也能一键生成可运行的桌面应用。
- 在发布为 EXE 后尽量做到离线可用、减少对目标机器 Node.js/npm 的依赖。

## 目录

- 功能概览
- 适用与边界
- 快速开始
- 一次完整打包流程
- 离线工具链设计（重点）
- 配置项说明
- 纯 HTML 自动补全模式
- 缓存、配置与清理策略
- 运行机制与执行链路
- 常见问题（FAQ）
- 开发说明
- 安全说明
- License

## 功能概览

- 可视化基础配置：项目路径、输出路径、应用元信息、产物命名等。
- 可视化构建策略：压缩级别、架构、asar、npmRebuild。
- 可视化平台参数：Windows/Linux/macOS 目标及其附加字段。
- 可视化资源规则：files、extraResources、asarUnpack（按行输入）。
- 构建过程可观测：分阶段状态、实时日志、可中断。
- 配置可持久化：支持保存/恢复表单配置。
- 纯 HTML 模式：自动生成临时 Electron 项目并打包。
- 离线工具链能力：打包后的 EXE 内置 electron-builder/npm，可在无系统 npm 的机器上工作。

## 适用与边界

适用：

- 希望给团队提供 GUI 打包入口，而不是让每个人记命令行参数。
- 需要快速把静态站点或 HTML 原型封装成桌面应用。
- 需要统一一套常用打包参数并复用。

不适用：

- 替代完整发布流水线（签名、公证、自动发布依然需要外部系统）。
- 自动完成业务项目构建（例如自动执行 `npm run build` 产出前端 dist）。

## 快速开始

### 开发运行

```bash
npm install
npm run start
```

### 打包本工具（生成 EXE）

```bash
npm run build
```

说明：`npm run build` 前会自动执行 `prebuild`，由 `pack-toolchain.js` 生成 `vendor/toolchain`，并把它嵌入 EXE。

## 一次完整打包流程

1. 在界面选择目标目录（Electron 项目或纯 HTML 目录）。
2. 选择输出目录，填写/调整构建参数。
3. 点击“读取项目信息”拉取默认值（如已有 package.json）。
4. 点击“立即开始打包”。
5. 观察日志和步骤状态（准备/配置/执行/完成）。
6. 可选：构建中点击“强行终止”。

## 离线工具链设计（重点）

为实现“发布后的 EXE 尽量不依赖目标机器 Node.js/npm”，项目采用了隔离式工具链打包。

### 打包阶段

- `pack-toolchain.js` 在 `vendor/toolchain` 内安装：
  - `electron-builder@26.8.1`
  - `npm`
- `electron-builder` 通过 `extraResources` 将其打入安装包：
  - `vendor/toolchain/node_modules`
  - `-> resources/embedded/toolchain/node_modules`

### 运行阶段（launcher 选择顺序）

主进程会按顺序选择可用入口：

1. 内置/本地可直达的 `electron-builder` CLI。
2. 缓存工具链（`.cache/builder/toolchain/...`）。
3. `npx --no-install electron-builder`。
4. `npm exec electron-builder`。

当系统没有 Node 时，会退化到 Electron 自带运行时并设置 `ELECTRON_RUN_AS_NODE=1` 去执行 CLI。

### 为什么这样设计

- 避开对系统 Node.js/npm 的硬依赖。
- 减少首次构建失败率（尤其是离线或受限网络环境）。
- 让“带着 EXE 到另一台机器直接用”更可行。

## 配置项说明

### 基础配置

- `projectDir`: 目标项目目录。
- `outputDir`: 产物输出目录（默认 `release`）。
- `appId`: 应用 ID。
- `productName`: 产品名。
- `executableName`: 可执行文件名。
- `artifactName`: 产物命名模板。
- `version` / `author` / `description`: 应用元信息。

### 构建策略

- `compression`: `store` / `normal` / `maximum`。
- `arches`: `x64`、`arm64`、`ia32`、`armv7l`、`universal`（支持逗号组合）。
- `asar`: 是否启用 asar。
- `npmRebuild`: 是否执行原生依赖重编译。
- `targetWindows` / `targetLinux` / `targetMac`: 平台开关。

### 运行时高级控制

- `electronVersion`: 指定构建使用的 Electron 版本。
- `chromiumVersion`: 以 `CHROMIUM_VERSION`/`npm_config_chromium_version` 注入。
- `nodeVersion`: 以 `NODE_VERSION`/`npm_config_node_version` 注入。
- `clearRuntimeOverridesAfterBuild`: 每次构建后自动清空上述版本覆盖字段。

说明：`chromiumVersion`、`nodeVersion` 主要用于原生依赖链路或项目自定义脚本读取，不会直接替换 Electron 内置运行时。

### 平台参数

- Windows:
  - `winTargets`: 如 `nsis`、`portable`、`zip`。
  - `winPortable`: 额外强制加入 `portable`。
  - `publisherName`: 发布者信息。
- Linux:
  - `linuxTargets`: 如 `AppImage`、`deb`、`rpm`。
  - `linuxCategory`: 分类。
- macOS:
  - `macTargets`: 如 `dmg`、`zip`。
  - `macCategory`: 分类。

### NSIS 参数

- `nsisOneClick`
- `nsisPerMachine`
- `nsisAllowElevation`
- `nsisAllowChangeDir`
- `nsisShortcutName`
- `nsisCreateDesktopShortcut` (`auto`/`always`/`never`)
- `nsisDeleteAppData`

### 资源规则

- `filesGlobs` -> `build.files`
- `extraResources` -> `build.extraResources`
- `asarUnpack` -> `build.asarUnpack`

### 纯 HTML 模式窗口参数

仅在自动补全模式生效：

- `windowTitle`
- `windowWidth`
- `windowHeight`
- `windowShowMenuBar`
- `windowFrame`
- `windowResizable`
- `windowFullscreenable`
- `windowAlwaysOnTop`

## 纯 HTML 自动补全模式

当 `projectDir` 没有 `package.json`，但目录中存在 HTML 文件时自动启用。

处理逻辑：

- 递归寻找入口页（优先 `index.html`，其次任意 `.html`）。
- 忽略目录：`node_modules`、`.git`、`release`、`dist`。
- 复制原目录到临时项目。
- 自动生成最小 `main.js` 与 `package.json`。
- 自动补齐关键 `files` 规则，确保可运行。
- 若输出目录是相对路径，会修正为基于源项目的绝对路径，避免临时目录清理后产物丢失。

## 缓存、配置与清理策略

### 缓存根目录

- 开发模式：`<仓库根目录>/.cache`
- 打包后运行：`<系统 appData>/<应用名>/.cache`

Windows 示例：`C:/Users/<用户名>/AppData/Roaming/html2exe/.cache`

### 主要缓存结构

- `.cache/electron/user-data`
- `.cache/electron/cache`
- `.cache/electron/temp`
- `.cache/electron/logs`
- `.cache/builder/temp`
- `.cache/builder/cache`
- `.cache/builder/electron-download`
- `.cache/builder/npm-cache`
- `.cache/builder/toolchain`

### 配置持久化

- 配置文件名：`builder-settings.json`
- 存储位置：Electron `userData` 目录
- 清理缓存不会删除保存的配置（不清理 user-data）

### 清理策略

- 启动时自动清理历史临时目录：
  - `electron-html-pack-*`
  - `electron-builder-ui-*`
- Windows 下遇到 `EBUSY/EPERM` 会尝试解除占用后重试。
- 仍有占用时会返回“部分清理”并列出跳过项。

## 运行机制与执行链路

1. 渲染进程收集表单数据并通过 preload IPC 发送。
2. 主进程做参数校验、归一化和目标类型判定。
3. Electron 项目直接打包；纯 HTML 项目先自动补全。
4. 生成临时 `electron-builder` 配置文件。
5. 解析可用 launcher（内置/缓存/npx/npm exec）。
6. 启动子进程执行构建并流式回传日志。
7. 构建结束后返回成功/失败/取消状态并执行清理。

## 常见问题（FAQ）

### 1. 提示“请先选择项目目录”

`projectDir` 为空，先选择目录再执行。

### 2. 提示“请至少选择一个目标平台”

Windows/Linux/macOS 至少开启一项。

### 3. 版本号校验失败

建议使用 `x.y.z`，例如 `1.0.0`。

### 4. 纯 HTML 模式下窗口参数不生效

窗口参数只作用于自动生成的 `main.js`。已有 Electron 项目需在自身窗口代码里修改。

### 5. 构建失败但日志看不出原因

优先检查：

- 目标项目依赖是否可正常安装。
- 是否缺失图标/资源路径。
- 是否存在平台签名要求。
- 是否需要先产出业务构建物（如前端 `dist`）。

### 6. 缓存读不到或工具链丢失

优先执行：

```bash
npm run prebuild
```

这会重建 `vendor/toolchain`，开发环境可立即恢复。已打包 EXE 需用新版本重新打包分发。

### 7. 清理缓存提示“部分清理，文件被占用”

通常是系统或外部进程占用。关闭相关程序（杀软扫描、资源管理器预览、占用目标目录的进程）后重试。

## 开发说明

主要文件：

- `main.js`: 主进程，含工具链解析、构建编排、缓存策略、IPC。
- `preload.js`: 安全桥接层，暴露 `builderApi`。
- `src/index.html`: UI 结构。
- `src/renderer.js`: 表单交互、校验、状态与日志渲染。
- `src/styles.css`: 页面样式。
- `pack-toolchain.js`: 预构建工具链脚本。

开发建议：

- 调整字段时保持渲染层与主进程字段同名。
- 新增 IPC 走 preload 白名单，避免放开 `nodeIntegration`。
- 修改清理逻辑时确保“不误删配置”。

## 安全说明

- 本工具只负责本机参数组装与命令调度，不托管签名证书。
- 打包命令在本机执行，请确保目标项目和依赖来源可信。
- 正式分发前请补齐签名、公证、许可证与合规流程。

## License

MIT
