# html2exe

`html2exe` 是一个基于 Electron 的桌面打包工具，定位于“把已有前端项目或者纯 HTML 目录，快速、可控地封装成桌面应用”的场景。它把 `electron-builder` 的常用参数、平台目标、输出策略和工具链准备过程整合到图形界面中，减少命令行配置成本，也降低了对外部 Node 环境的依赖。

这个项目目前更接近一个“打包工作台”而不是单纯的启动器。它关注的是打包配置整理、构建执行、日志反馈和缓存管理，而不是接管业务项目本身的编译流程。

## 适用场景

`html2exe` 适合以下工作模式：

- 需要把 Electron 项目统一打包成安装包、便携包或压缩包。
- 需要把静态站点、原型页面、单页 HTML 项目快速封装为桌面程序。
- 希望把常用构建参数沉淀成预设，减少重复配置。
- 需要在网络受限或离线环境中尽量稳定地完成构建。

它不负责替代完整发布流水线，例如代码签名、公证、自动分发、制品管理，也不负责业务应用前端的构建产出。它的职责是把“可以被打包的内容”整理成可执行的 Electron 打包流程。

## 核心能力

- 图形化管理项目目录、输出目录、应用信息和命名模板。
- 图形化管理压缩、架构、asar、npmRebuild 和 Electron 版本覆盖。
- 图形化管理 Windows、Linux、macOS 的目标组合与平台特定参数。
- 图形化管理 files、extraResources 和 asarUnpack 等资源规则。
- 内置四种构建预设，适配正式发布、快速验证、体积优先和跨平台分发。
- 构建过程支持实时日志、步骤状态、整体状态与取消操作。
- 配置可持久化保存，重启后自动恢复。
- 纯 HTML 目录可自动补全为临时 Electron 工程。
- 内置并缓存 electron-builder 与 npm，降低目标机器上的环境依赖。
- 独立输出页用于集中查看打包过程和结果。

## 界面结构

应用分为配置页和输出页两部分，侧边栏用于切换主要功能区。

### 配置页

配置页包含六个主要模块：基础配置、构建策略、平台参数、安装包设置、窗口与图标、文件与资源。

- 基础配置用于填写项目路径、输出路径和应用元信息。
- 构建策略用于控制打包行为、平台启用情况和预设方案。
- 平台参数用于配置 Windows、Linux 和 macOS 的目标类型、分类和安装器细节。
- 安装包设置用于补充 Windows NSIS 相关行为。
- 窗口与图标用于定义纯 HTML 模式下的窗口外观与应用图标。
- 文件与资源用于控制最终进入产物的资源范围。

配置页还提供几个核心操作按钮：读取项目信息、保存当前配置、清理构建缓存，以及跳转到输出页面。

### 输出页

输出页专门用于展示构建过程。页面包含：

- 进度状态区域，用于展示当前整体状态。
- 步骤条区域，用于展示预清理、临时工程准备、依赖加载、打包、产物生成和收尾。
- 实时日志区域，用于显示构建工具输出。
- 打包、取消和清空日志等操作按钮。

这种页面拆分的设计目的是将“配置”和“执行”分离，降低构建过程中反复切页和查找状态的成本。

## 快速开始

### 本地运行

```bash
npm install
npm run start
```

`npm run dev` 与 `npm run start` 是等价的，都会直接启动 Electron 应用。

### 构建当前工具

```bash
npm run build
```

构建命令会先执行 `prebuild`，由 `pack-toolchain.js` 生成或刷新 `vendor/toolchain`，再交给 `electron-builder` 产出安装包。

## 典型使用流程

1. 打开应用，在基础配置中选择项目目录和输出目录。
2. 填写或调整应用 ID、产品名称、版本号、作者和产物命名模板。
3. 选择一个构建预设，或者手动调整压缩、架构、asar 和目标平台。
4. 如有需要，补充平台参数、安装包参数、窗口参数和资源规则。
5. 点击读取项目信息，让程序根据目标目录自动回填默认值。
6. 切到输出页，点击开始打包，并在日志和步骤状态中观察执行过程。
7. 如果构建被中止或需要重新开始，可以使用取消操作或清空日志。

## 配置项说明

### 基础配置

- `projectDir`：目标项目目录，既支持标准 Electron 项目，也支持纯 HTML 目录。
- `outputDir`：产物输出目录，默认值是 `release`。
- `appId`：应用标识，用于安装包和系统识别。
- `productName`：产品名称，通常会用于安装器和产物展示。
- `executableName`：主执行文件名。
- `artifactName`：产物命名模板。
- `version`：应用版本号。
- `author`：作者或组织名称。
- `description`：应用简介。

项目目录是整个流程的入口。程序会先判断目录中是否存在标准 Electron 配置，再决定是否进入纯 HTML 自动补全模式。

### 构建策略

- `compression`：控制打包压缩级别，支持 `store`、`normal`、`maximum`。
- `arches`：控制目标架构，支持 `x64`、`arm64`、`ia32`、`armv7l`、`universal`，并允许组合写法。
- `asar`：是否启用 asar 封装。
- `npmRebuild`：是否在打包前重编译原生依赖。
- `targetWindows` / `targetLinux` / `targetMac`：是否启用对应平台构建。
- `buildPreset`：构建预设。

当前提供的预设如下：

- `release`：默认推荐方案，平衡速度、兼容性和产物质量。
- `quick`：快速验证方案，优先缩短构建时间。
- `compact`：体积优先方案，优先压缩产物体积。
- `cross`：跨平台分发方案，一次生成多个平台目标。

### 运行时高级控制

- `electronVersion`：指定构建所使用的 Electron 版本。
- `chromiumVersion`：通过环境变量注入 Chromium 版本覆盖值。
- `nodeVersion`：通过环境变量注入 Node.js 版本覆盖值。
- `clearRuntimeOverridesAfterBuild`：构建结束后自动清空上述高级版本字段。

这里的 Chromium 和 Node.js 版本覆盖，主要用于原生依赖编译或外部脚本读取，不会直接替换 Electron 自带运行时。它们更适合用于构建上下文标记，而不是运行时强制升级。

### Windows 参数

- `winTargets`：Windows 构建目标，例如 `nsis`、`portable`、`zip`。
- `winPortable`：额外输出便携版。
- `publisherName`：发布者信息。
- `nsisOneClick`：是否启用单击安装。
- `nsisPerMachine`：是否按机器范围安装。
- `nsisAllowElevation`：是否允许提权。
- `nsisAllowChangeDir`：是否允许修改安装目录。
- `nsisShortcutName`：快捷方式名称。
- `nsisCreateDesktopShortcut`：桌面快捷方式策略，支持 `auto`、`always`、`never`。
- `nsisDeleteAppData`：卸载时是否删除应用数据。

这部分参数主要用于控制 Windows 安装体验。对于需要标准安装器、绿色单文件版或压缩包分发的项目，这些选项很关键。

### Linux 参数

- `linuxTargets`：Linux 构建目标，例如 `AppImage`、`deb`、`rpm`。
- `linuxCategory`：应用分类，例如 `Utility`、`Development`、`Office`。

Linux 目标适合面向发行版、内部测试包或统一可执行包分发的场景。

### macOS 参数

- `macTargets`：macOS 构建目标，例如 `dmg`、`zip`。
- `macCategory`：应用分类。

macOS 目标更偏向镜像式发布和归档分发。

### 窗口与图标

- `winIcon`：Windows 图标路径。
- `linuxIcon`：Linux 图标路径。
- `macIcon`：macOS 图标路径。

在纯 HTML 自动补全模式下，这组参数会直接影响生成的窗口配置；如果原本就是 Electron 项目，则应以项目自身的主进程窗口逻辑为准。

### 文件与资源规则

- `filesGlobs` 对应 `build.files`。
- `extraResources` 对应 `build.extraResources`。
- `asarUnpack` 对应 `build.asarUnpack`。

如果某项在 `package.json` 中是对象形式，例如 `extraResources` 常见的 `{ "from": "...", "to": "..." }`，界面按“每行一条 JSON”输入。字符串规则则按行填写即可。

## 纯 HTML 自动补全模式

当目标目录中没有 `package.json`，但存在 HTML 文件时，程序会自动启用纯 HTML 模式。

处理过程大致如下：

- 优先寻找 `index.html`，其次递归搜索其他 HTML 文件。
- 自动忽略 `node_modules`、`.git`、`release`、`dist` 等目录。
- 将原目录复制到临时工程中。
- 自动生成最小可用的 `main.js` 和 `package.json`。
- 自动补齐关键 `files` 规则，确保内容可以被打入产物。
- 如果输出目录是相对路径，会自动转换成基于源项目的绝对路径，避免临时目录清理后找不到结果。

这意味着一个纯静态目录可以直接交给工具，而不必先手工改造成完整 Electron 项目。

## 工具链与缓存

### 设计目标

项目将构建工具链拆成独立缓存，目标是让已打包的程序在目标机器上尽量少依赖外部环境。

### 打包阶段

`pack-toolchain.js` 会在 `vendor/toolchain` 中准备构建依赖，当前包括：

- `electron-builder@26.8.1`
- `npm`

随后，`afterPack.js` 会把 `vendor/toolchain/node_modules` 复制到应用资源目录中，以便运行时查找和恢复。

### 运行阶段的查找顺序

主进程会按优先级寻找可用的 `electron-builder` 入口：

1. 内置或本地可直接访问的 `electron-builder` CLI。
2. 本地缓存的工具链目录。
3. `npx --no-install electron-builder`。
4. `npm exec electron-builder`。

如果系统没有可用的 `Node.js` 或 `npm`，程序会尽量回退到 Electron 自带运行时，并通过 `ELECTRON_RUN_AS_NODE=1` 执行 CLI。

### 这样设计的价值

- 降低对系统级 Node 环境的依赖。
- 提升离线或受限网络环境中的首次构建成功率。
- 让打包后的工具在另一台机器上更容易直接使用。

### 缓存位置

- 开发模式：仓库根目录下的 `.cache`
- 打包后运行：`appData` 对应的应用目录下的 `.cache`

Windows 示例：`C:/Users/<用户名>/AppData/Roaming/html2exe/.cache`

### 缓存内容

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

- 启动时会尝试清理历史临时目录，例如 `electron-html-pack-*`、`electron-builder-ui-*`
- Windows 下遇到 `EBUSY` 或 `EPERM` 时会尝试重试
- 如果仍被占用，程序会返回“部分清理”，并列出被跳过的项

## 构建执行链路

1. 渲染进程收集表单数据，并通过 preload 暴露的 IPC 接口发送给主进程。
2. 主进程校验参数、做归一化处理，并判断当前项目是 Electron 项目还是纯 HTML 项目。
3. 纯 HTML 项目会先进入自动补全流程，生成临时工程结构。
4. 主进程生成临时 electron-builder 配置。
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

## 开发与维护

项目的职责分层比较清晰：主进程负责工具链解析、构建编排、缓存策略和 IPC；预加载脚本负责暴露受控接口；渲染层负责表单、状态和日志展示。新增配置字段时，建议保持渲染层和主进程字段名一致，这样更容易维持参数的单向映射关系。

如果需要扩展构建链路，优先验证本地运行，再验证 `npm run build`。涉及清理逻辑时，要确保不会误删配置或用户数据；涉及 IPC 时，尽量继续走 preload 白名单，而不是扩大页面权限。

## 安全说明

- 本工具只负责本机参数组装和命令调度，不托管签名证书。
- 打包命令会在本机执行，请确认目标项目和依赖来源可信。
- 正式分发前，请补齐签名、公证、许可证和合规流程。

## 许可证

MIT
