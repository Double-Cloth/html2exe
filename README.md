# html2exe

html2exe 是一个基于 Electron 的桌面可视化打包工具，用于图形化配置并调用 electron-builder，快速生成 Windows、Linux、macOS 安装产物。

它既支持标准 Electron 项目，也支持仅包含 HTML 文件的目录，并可在后者场景下自动补全最小可打包结构。

## 目录

- 项目定位
- 核心能力
- 工作原理
- 环境要求
- 快速开始
- 使用流程
- 配置项说明
- 纯 HTML 自动补全模式
- 构建命令与产物
- 缓存与配置持久化
- 日志、状态与取消机制
- 常见问题
- 开发说明
- 安全与边界
- License

## 项目定位

适用场景：

- 需要为 Electron 项目提供可视化打包入口，降低命令行门槛。
- 需要快速试产纯 HTML 桌面壳应用（无现成 package.json/main.js）。
- 需要统一管理常见打包参数（asar、targets、NSIS、图标、资源规则等）。

不适用场景：

- 替代完整 CI/CD 发布流水线（签名、公证、自动发布仍需自行集成）。
- 自动完成业务构建步骤（如前端构建、原生依赖预编译等）。

## 核心能力

- 可视化基础配置：项目路径、输出路径、应用元信息、artifact 命名等。
- 可视化构建策略：asar、compression、npmRebuild、多架构选择。
- 运行时高级控制：可指定 Electron 版本，并覆盖 Chromium/Node.js 版本环境变量。
- 可视化平台参数：Windows/Linux/macOS targets、分类、图标、NSIS 选项。
- 可视化资源规则：files、extraResources、asarUnpack（按行输入）。
- 支持构建状态分阶段展示：准备、临时项目、安装、封装、产物、完成。
- 支持实时日志输出与构建中断。
- 支持配置保存与恢复。
- 支持缓存清理（不删除已保存配置）。
- 支持“纯 HTML 自动补全打包”模式。

## 工作原理

1. 界面层收集表单参数，通过 preload 暴露的 IPC 能力发送到主进程。
2. 主进程执行参数校验与归一化。
3. 若目标目录包含 package.json，则按 Electron 项目直接打包。
4. 若不包含 package.json 但存在 HTML 文件，则进入纯 HTML 自动补全流程：
   - 复制源目录到临时工程。
   - 自动生成最小 main.js 与 package.json。
   - 注入窗口参数并补齐必需打包文件规则。
5. 主进程生成临时 electron-builder 配置文件并调用 npx electron-builder。
6. 若设置了高级运行时版本，会将 Chromium/Node.js 覆盖值以环境变量注入构建流程。
7. 实时解析 stdout/stderr 更新日志与步骤状态。
8. 构建结束后清理临时文件与临时工程。

## 环境要求

- Node.js 18 及以上（建议 LTS）。
- npm 9 及以上。
- Windows/macOS/Linux 任一桌面环境。
- 首次安装依赖需要网络访问 npm registry。

注意：跨平台打包受 electron-builder 和系统能力限制，例如在 Windows 上直接产出 macOS 可分发产物通常不可行。

## 快速开始

```bash
npm install
npm run start
```

常用脚本：

- npm run start: 启动应用。
- npm run dev: 与 start 等价。
- npm run build: 构建当前工具自身安装包（electron-builder）。

## 使用流程

1. 启动应用后选择“Electron 项目目录”。
2. 选择“打包输出目录”（可选，默认 release）。
3. 点击“读取项目信息”自动读取项目可用默认值。
4. 根据需要调整构建策略、平台参数、资源规则、图标与窗口设置。
5. 点击“保存当前配置”持久化当前表单。
6. 点击“立即开始打包”执行构建。
7. 在日志面板观察构建详情与步骤状态。
8. 如需中断，点击“强行终止”。

## 配置项说明

### 基础配置

- projectDir: 目标项目目录。
- outputDir: 产物输出目录，默认 release。
- appId: 应用 ID。
- productName: 产品名称。
- executableName: 可执行文件名。
- artifactName: 产物命名模板。
- version/author/description: 应用元信息。

### 构建策略

- compression: store/normal/maximum。
- arches: x64、arm64、ia32、armv7l、universal（可逗号组合）。
- asar: 是否启用 asar。
- npmRebuild: 是否执行 native 依赖重编译。
- targetWindows/targetLinux/targetMac: 目标平台开关。

### 运行时高级控制

- electronVersion: 指定 electron-builder 使用的 Electron 版本。
- chromiumVersion: 以 `CHROMIUM_VERSION` 与 `npm_config_chromium_version` 形式注入构建环境（高级）。
- nodeVersion: 以 `NODE_VERSION` 与 `npm_config_node_version` 形式注入构建环境（高级）。
- clearRuntimeOverridesAfterBuild: 勾选后在每次打包结束时自动清空以上三个高级版本字段，并保存配置。

说明：Chromium/Node.js 字段主要用于原生依赖编译链路或项目自定义脚本读取，不会直接替代 Electron 内置运行时。
界面提供主流版本下拉建议，同时支持手动输入自定义版本。

### 平台参数

- Windows
  - winTargets: 如 nsis、portable、zip。
  - winPortable: 强制额外加入 portable（去重后并入 target）。
  - publisherName: 发布者信息。
- Linux
  - linuxTargets: 如 AppImage、deb、rpm。
  - linuxCategory: Linux 分类。
- macOS
  - macTargets: 如 dmg、zip。
  - macCategory: macOS 分类。

### NSIS 参数

- nsisOneClick
- nsisPerMachine
- nsisAllowElevation
- nsisAllowChangeDir
- nsisShortcutName
- nsisCreateDesktopShortcut: auto/always/never
- nsisDeleteAppData

### 资源与文件规则

- filesGlobs: 映射到 build.files（按行分隔）。
- extraResources: 映射到 build.extraResources（按行分隔）。
- asarUnpack: 映射到 build.asarUnpack（按行分隔）。

### 窗口参数

窗口参数仅在“纯 HTML 自动补全模式”生效：

- windowTitle
- windowWidth
- windowHeight
- windowShowMenuBar
- windowFrame
- windowResizable
- windowFullscreenable
- windowAlwaysOnTop

## 纯 HTML 自动补全模式

当 projectDir 不含 package.json，但存在任意 HTML 文件时，将自动进入该模式。

自动处理行为：

- 递归查找入口 HTML：优先 index.html，其次任意 .html。
- 忽略扫描目录：node_modules、.git、release、dist。
- 在临时工程自动生成：
  - main.js（含窗口参数）
  - package.json（含 electron devDependency）
- 自动补齐 files 关键规则，确保至少包含：
  - main.js
  - package.json
  - app-source/**
  - !release/**
- 自动修正 outputDir：
  - 若填写相对路径，解析到源目录绝对路径，避免临时工程清理后产物丢失。

## 构建命令与产物

主进程实际调用：

```bash
npx electron-builder --projectDir <目录> --config <临时配置.json> [--x64|--arm64|...] [--win] [--linux] [--mac]
```

参数细节：

- 优先使用本地已安装 electron-builder（npx --no-install）。
- 根据 arches 追加架构参数。
- 根据目标平台开关追加 --win/--linux/--mac。
- Windows 目标构建时，若 asar 关闭会自动开启，降低 app.asar 缺失导致失败的概率。

## 缓存与配置持久化

本项目会按运行模式选择缓存根目录：

- 开发模式（`npm run start`）：`<仓库根目录>/.cache`
- 打包后运行（EXE）：`<系统 appData>/<应用名>/.cache`

Windows 默认示例（应用名为 html2exe）：

- `C:/Users/<用户名>/AppData/Roaming/html2exe/.cache`

缓存结构：

- .cache/electron/user-data
- .cache/electron/cache
- .cache/electron/temp
- .cache/electron/logs
- .cache/builder/temp
- .cache/builder/cache
- .cache/builder/electron-download
- .cache/builder/npm-cache

配置文件：

- builder-settings.json 保存在 Electron userData 路径。
- 清理缓存功能不会删除已保存配置（不清理 user-data 目录）。

兼容清理：

- 启动时会尝试清理历史遗留临时目录：
  - electron-html-pack-*
  - electron-builder-ui-*
- 清理缓存遇到 EBUSY/EPERM 时，会在 Windows 下自动尝试结束占用该路径的进程后重试删除。
- 若仍有文件被占用，界面会显示“部分清理”并列出被跳过项，便于二次重试。

## 日志、状态与取消机制

- 通过 builder:log 实时输出 stdout/stderr。
- 通过 builder:status 更新 overall 与 step 状态。
- 支持运行中取消：发送 kill 请求，构建状态转为 canceled。
- 失败、取消、成功均有明确结果回传。

## 常见问题

### 1) 点击开始后提示“请先选择项目目录”

未设置 projectDir。请先选择待打包目录。

### 2) 提示“请至少选择一个目标平台”

需要至少启用 Windows/Linux/macOS 中一项。

### 3) 版本号不通过校验

建议使用 x.y.z 形式，例如 1.0.0。

### 4) 纯 HTML 模式下窗口参数未生效

窗口参数只对“自动补全生成 main.js”的模式生效。已有 Electron 项目请在自身窗口代码中修改。

### 5) 构建失败但日志不明显

先检查：

- 目标项目是否能独立 npm install。
- 是否存在平台特定依赖与签名要求。
- 是否缺失图标或资源路径。
- 目标项目是否需要先执行构建步骤（如前端 dist 产出）。

### 6) 为什么 Windows 构建会自动开启 asar

用于降低 win-unpacked 目录中 app.asar 缺失导致的常见失败风险。

### 7) 清理缓存提示“部分清理，文件被占用”

工具会先自动尝试解除占用并重试清理；若仍失败，通常是系统级占用（例如安全软件扫描、资源管理器预览或外部进程正在访问）。关闭相关程序后再次点击“清理缓存”即可。

## 开发说明

代码结构：

- main.js: 主进程，包含缓存路径、打包流程、IPC、状态分发。
- preload.js: 安全桥接层，向渲染进程暴露 builderApi。
- src/index.html: 图形界面。
- src/renderer.js: 表单逻辑、校验、日志渲染、状态显示。
- src/styles.css: 样式定义。

开发建议：

- 修改构建参数时，保持前后端字段名一致（renderer form 与 main buildTargetConfig）。
- 新增 IPC 能力时，优先通过 preload 白名单方式暴露，避免直接开启 nodeIntegration。
- 与缓存相关的改动需保证“可清理但不误删配置”的边界。

## 安全与边界

- 当前项目仅负责参数组织与打包调度，不处理代码签名证书托管。
- 构建命令在本机执行，请确保目标目录与依赖来源可信。
- 对外分发前请自行补充签名、公证、许可证与合规检查。

## License

MIT
