# html2exe

`html2exe` 是一个基于 Electron 的图形化打包工具，面向 Electron 项目和纯 HTML 目录，提供可视化配置、构建编排和离线工具链支持，帮助用户更稳定地生成桌面安装包或便携包。

它的核心目标很明确：

- 降低 `electron-builder` 的使用门槛，把常见参数收敛到界面中。
- 支持把纯静态 HTML 目录快速封装为可运行的桌面应用。
- 尽量让打包后的工具在目标机器上摆脱对系统 `Node.js` 和 `npm` 的强依赖。

## 目录

- 项目定位
- 主要能力
- 快速开始
- 使用流程
- 配置说明
- 纯 HTML 自动补全模式
- 离线工具链与缓存
- 构建执行链路
- 常见问题
- 开发说明
- 安全说明
- License

## 项目定位

适合以下场景：

- 团队需要一个 GUI 入口来统一 Electron 打包参数，而不是分散地记命令行。
- 需要把静态站点、原型页、单页 HTML 项目快速封装为桌面程序。
- 希望将常用构建策略固化成预设，减少每次手动配置的成本。

不适合以下场景：

- 代替完整的发布流水线，例如代码签名、公证、自动分发和制品管理。
- 自动完成业务项目构建，例如一键执行前端 `build` 并接续打包流程。

## 主要能力

- 可视化基础配置：项目目录、输出目录、应用信息、产物命名模板。
- 可视化构建策略：压缩级别、架构、`asar`、`npmRebuild`、Electron 版本覆盖。
- 可视化平台参数：Windows、Linux、macOS 的目标组合和平台附加项。
- 可视化资源规则：`files`、`extraResources`、`asarUnpack` 支持按行编辑。
- 构建预设：发布推荐、快速验证、体积优先、跨平台分发。
- 构建反馈：日志流、步骤状态、整体状态、取消打包。
- 配置持久化：保存当前配置并下次恢复。
- 纯 HTML 自动补全：自动生成临时 Electron 项目并完成打包。
- 离线工具链：内置并缓存 `electron-builder` 和 `npm`，降低环境依赖。

## 快速开始

### 本地运行

```bash
npm install
npm run start
```

`npm run dev` 与 `npm run start` 等价，都会直接启动 Electron 应用。

### 打包当前工具

```bash
npm run build
```

`npm run build` 会先触发 `prebuild`，由 `pack-toolchain.js` 生成或更新 `vendor/toolchain`，再交给 `electron-builder` 产出安装包。

## 使用流程

1. 打开应用后，在“基础配置”中选择目标项目目录。
2. 选择输出目录，并补全应用信息和命名规则。
3. 在“构建策略”中选择预设，或手动调整压缩、架构和平台目标。
4. 如有需要，在“平台参数”“安装包设置”“窗口与图标”“文件与资源”中进一步细化配置。
5. 点击“读取项目信息”，让程序从目标项目中加载可用默认值。
6. 切换到输出页，点击“开始打包”。
7. 根据日志和步骤状态观察进度，必要时使用“取消打包”。

## 配置说明

### 基础配置

- `projectDir`：目标项目目录，支持 Electron 项目或纯 HTML 目录。
- `outputDir`：产物输出目录，默认是 `release`。
- `appId`：应用 ID，用于安装包标识。
- `productName`：产品名称。
- `executableName`：主执行文件名。
- `artifactName`：产物命名模板。
- `version`：应用版本号。
- `author`：作者或组织名称。
- `description`：应用简介。

### 构建策略

- `compression`：`store`、`normal`、`maximum`。
- `arches`：`x64`、`arm64`、`ia32`、`armv7l`、`universal`，支持组合值。
- `asar`：是否启用 `asar` 打包。
- `npmRebuild`：是否重编译原生依赖。
- `targetWindows` / `targetLinux` / `targetMac`：是否启用对应平台构建。
- `buildPreset`：构建预设，提供一组常用参数组合。

预设含义如下：

- `release`：发布推荐，兼顾速度、兼容性和产物质量。
- `quick`：快速验证，优先缩短构建时间。
- `compact`：体积优先，优先压缩产物体积。
- `cross`：跨平台分发，一次生成多个平台目标。

### 运行时高级控制

- `electronVersion`：指定构建使用的 Electron 版本。
- `chromiumVersion`：通过环境变量向构建链路注入 Chromium 版本覆盖值。
- `nodeVersion`：通过环境变量向构建链路注入 Node.js 版本覆盖值。
- `clearRuntimeOverridesAfterBuild`：构建结束后自动清空上述高级版本字段。

说明：`chromiumVersion` 和 `nodeVersion` 主要用于原生依赖编译或自定义脚本读取，不会直接替换 Electron 自带运行时。

### Windows 参数

- `winTargets`：例如 `nsis`、`portable`、`zip`。
- `winPortable`：额外强制产出便携版。
- `publisherName`：发布者信息。
- `nsisOneClick`：是否启用单击安装。
- `nsisPerMachine`：是否按机器范围安装。
- `nsisAllowElevation`：是否允许提权。
- `nsisAllowChangeDir`：是否允许修改安装目录。
- `nsisShortcutName`：快捷方式名称。
- `nsisCreateDesktopShortcut`：桌面快捷方式策略，支持 `auto`、`always`、`never`。
- `nsisDeleteAppData`：卸载时是否删除应用数据。

### Linux 参数

- `linuxTargets`：例如 `AppImage`、`deb`、`rpm`。
- `linuxCategory`：应用分类，例如 `Utility`、`Development`、`Office`。

### macOS 参数

- `macTargets`：例如 `dmg`、`zip`。
- `macCategory`：应用分类。

### 窗口与图标

- `winIcon`：Windows 图标。
- `linuxIcon`：Linux 图标。
- `macIcon`：macOS 图标。

### 文件与资源规则

- `filesGlobs` -> `build.files`
- `extraResources` -> `build.extraResources`
- `asarUnpack` -> `build.asarUnpack`

说明：如果某项在 `package.json` 中是对象，例如 `extraResources` 常见的 `{ "from": "...", "to": "..." }` 形式，界面按“每行一条 JSON”输入；字符串规则则按行填写即可。

### 纯 HTML 模式窗口参数

仅在自动补全模式下生效：

- `windowTitle`
- `windowWidth`
- `windowHeight`
- `windowShowMenuBar`
- `windowFrame`
- `windowResizable`
- `windowFullscreenable`
- `windowAlwaysOnTop`

## 纯 HTML 自动补全模式

当目标目录中没有 `package.json`，但存在 HTML 文件时，程序会自动启用纯 HTML 模式。

处理逻辑如下：

- 优先寻找 `index.html`，其次递归查找其他 `.html` 文件。
- 自动忽略 `node_modules`、`.git`、`release`、`dist` 等目录。
- 将原目录复制到临时项目中。
- 自动生成最小可用的 `main.js` 和 `package.json`。
- 自动补齐关键 `files` 规则，确保内容可被打入产物。
- 如果输出目录是相对路径，会自动转成基于源项目的绝对路径，避免临时目录清理后找不到结果。

这意味着你可以把一个纯静态目录直接交给工具，不必先手工改造成完整 Electron 项目。

## 离线工具链与缓存

### 设计目标

本项目把构建工具链拆成独立缓存，目的是让已打包的程序在目标机器上尽量少依赖外部环境。

### 打包阶段

`pack-toolchain.js` 会在 `vendor/toolchain` 中准备构建依赖，当前包含：

- `electron-builder@26.8.1`
- `npm`

随后，`afterPack.js` 会把 `vendor/toolchain/node_modules` 复制到应用资源目录中，供运行时查找和恢复。

### 运行阶段的查找顺序

主进程会按优先级寻找可用的 `electron-builder` 入口：

1. 内置或本地可直接访问的 `electron-builder` CLI。
2. 本地缓存的工具链目录。
3. `npx --no-install electron-builder`。
4. `npm exec electron-builder`。

如果系统没有可用的 `Node.js`/`npm`，程序会尽量退回到 Electron 自带运行时，并通过 `ELECTRON_RUN_AS_NODE=1` 执行 CLI。

### 这样做的价值

- 降低对系统级 Node 环境的依赖。
- 提升离线环境、受限网络环境中的首次构建成功率。
- 让打包后的工具在其他机器上更容易直接使用。

## 缓存与配置

### 缓存根目录

- 开发模式：仓库根目录下的 `.cache`
- 打包后运行：`appData` 对应的应用目录下的 `.cache`

Windows 示例：`C:/Users/<用户名>/AppData/Roaming/html2exe/.cache`

### 主要缓存内容

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
- 存储位置：Electron 的 `userData` 目录
- 清理缓存不会删除已保存配置，因为不会清理 `user-data`

### 清理策略

- 启动时会尝试清理历史临时目录，例如：`electron-html-pack-*`、`electron-builder-ui-*`
- Windows 下遇到 `EBUSY` 或 `EPERM` 时会尝试重试。
- 如果仍被占用，程序会返回“部分清理”，并列出被跳过的项。

## 构建执行链路

1. 渲染进程收集表单数据，并通过 `preload` 暴露的 IPC 接口发送给主进程。
2. 主进程校验参数、做归一化处理，并判断当前项目是 Electron 项目还是纯 HTML 项目。
3. 纯 HTML 项目会先进入自动补全流程，生成临时工程结构。
4. 主进程生成临时 `electron-builder` 配置。
5. 系统解析可用的构建入口，优先使用内置和缓存工具链。
6. 启动子进程执行构建，并把日志流式回传到界面。
7. 构建完成后返回成功、失败或取消状态，并执行必要清理。

## 常见问题

### 提示“请先选择项目目录”

说明 `projectDir` 为空，先选定目录再执行打包。

### 提示“请至少选择一个目标平台”

Windows、Linux、macOS 至少需要开启一项。

### 版本号校验失败

建议使用标准语义化版本号，例如 `1.0.0`。

### 纯 HTML 模式下窗口参数不生效

这些参数只作用于自动生成的 `main.js`。如果原本就是 Electron 项目，需要在项目自身的窗口创建逻辑里修改。

### 构建失败但日志不够明确

优先检查以下内容：

- 目标项目依赖是否能正常安装。
- 图标或资源路径是否缺失。
- 当前平台是否存在签名或系统权限要求。
- 业务构建物是否已经产出，例如前端 `dist`。

### 缓存读不到或工具链丢失

可以先执行：

```bash
npm run prebuild
```

这会重建 `vendor/toolchain`。如果已经发布过 EXE，则需要重新打包并分发新版。

### 清理缓存提示“部分清理，文件被占用”

通常是系统进程、资源管理器预览窗格、杀毒软件或其他占用目标目录的程序导致。关闭相关进程后重试即可。

## 开发说明

### 主要文件

- `main.js`：主进程，负责工具链解析、构建编排、缓存策略和 IPC。
- `preload.js`：安全桥接层，向渲染进程暴露有限 API。
- `src/index.html`：主界面结构。
- `src/output.html`：输出页，用于展示构建执行过程与结果。
- `src/renderer.js`：表单交互、校验、状态和日志渲染。
- `src/styles.css`：页面样式。
- `pack-toolchain.js`：预构建工具链脚本。
- `afterPack.js`：打包后复制内置工具链到资源目录。

### 常见开发建议

- 新增配置字段时，尽量保持渲染层和主进程字段名一致。
- 新增 IPC 时走 `preload` 白名单，不要直接放开 `nodeIntegration`。
- 修改清理逻辑时，确认不会误删配置或用户数据。
- 如果涉及构建链路变更，先验证本地运行，再验证 `npm run build`。

## 安全说明

- 本工具只负责本机参数组装和命令调度，不托管签名证书。
- 打包命令会在本机执行，请确认目标项目和依赖来源可信。
- 正式分发前，请补齐签名、公证、许可证和合规流程。

## 许可证

MIT
