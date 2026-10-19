# 功能文档

html2exe 将打包配置和 electron-builder 的执行过程集中到图形界面。源码启动、自打包与测试命令见 [README](../README.md)，内部实现见 [开发文档](development.md)。

## 项目准备

| 项目类型 | 识别方式 | 使用前准备 |
| --- | --- | --- |
| Electron 项目 | 所选目录存在 `package.json` | 确保 `name`、入口和页面有效，提前完成业务项目的编译 |
| 纯 HTML 目录 | 没有 `package.json`，但能找到 `.html` 文件 | 准备 HTML、CSS、JavaScript 和静态资源，无需手写 Electron 入口 |

存在 `package.json` 时始终按 Electron 项目处理，不会自动判断它是否只是一个前端工程。Vue、React 等项目应先自行生成静态产物，再选择不含 `package.json` 的产物目录。工具不会代为执行业务项目的 `npm run build`。

Electron 项目已有 `node_modules` 时跳过依赖安装；缺少时，有 `package-lock.json` 使用 `npm ci`，否则使用 `npm install`，会在原项目中安装开发依赖和可选依赖。项目安装脚本及构建钩子会在本机执行。

内置工具链包含 electron-builder、npm 和 rcedit，可在没有系统 Node/npm 时使用 Electron 运行 CLI。Electron 二进制、平台构建工具及项目依赖仍可能需要下载，内置工具链不代表首次构建完全离线。

## 操作流程

1. 选择项目目录。通过「浏览」选择后会自动读取项目信息；手动输入路径后点击「读取项目信息」。
2. 检查回填结果，再修改应用信息与输出目录。读取会补齐空白文本字段，并更新返回的复选框设置；切换项目时需核对已有值。
3. 选择预设并点击「应用预设」，随后调整平台、架构、图标和资源规则。
4. 点击「前往输出页面」，应用会先保存当前配置。
5. 点击「开始打包」，查看步骤状态与实时日志，完成后到输出目录领取产物。

同一时间只运行一个构建。构建期间不能返回配置页或清理缓存；「取消打包」在准备、依赖安装和打包阶段均可发起，实际退出与收尾需要等待。清空日志只清除显示内容，不会取消任务或重置当前进度。

## 应用更新提示

每次启动 html2exe 后，会在后台检查 [GitHub Releases](https://github.com/Double-Cloth/html2exe/releases) 中标记为 Latest 的正式版本。发现高于当前应用版本的新版本时，弹窗显示当前版本与最新版本；点击「前往发布页」会通过系统浏览器打开对应版本页面，可查看说明并手动下载。点击「稍后再说」或关闭弹窗后，本次运行不再提醒，下次启动重新检查。

检查请求最多等待 8 秒；断网、请求超时、GitHub 限流或暂无正式发布时，不弹出错误，也不影响正常使用。草稿、预发布版本、相同版本和更旧的版本不会触发提示。此功能仅检查 html2exe 本身，不会为打包生成的应用加入更新功能。

## 基础配置

| 字段 | 说明 |
| --- | --- |
| `projectDir` | Electron 项目根目录或纯 HTML 目录 |
| `outputDir` | 默认 `release`；相对路径基于所选项目，支持绝对路径 |
| `appId` | 应用标识，例如 `com.example.desktop` |
| `productName` / `executableName` | 展示名称 / 主执行文件名 |
| `artifactName` | 产物命名模板，例如 `${productName}-${version}-${os}-${arch}.${ext}` |
| `version` | SemVer 版本，例如 `1.0.0`、`1.0.0-beta.1` |
| `author` / `authorEmail` | 开发者或组织名称 / 邮箱 |
| `homepage` / `description` | 项目主页 / 应用简介 |

输出目录不能是源码目录本身或其祖先目录，目录链接也会按真实路径检查。可使用项目内独立的输出子目录，或源码之外的独立目录。

已有 Electron 项目的 `package.json.build` 会与界面配置合并：界面生成的值优先，未覆盖的钩子、签名和其他配置保留。高级选项可继续写在目标项目的 `package.json.build` 中。

## 构建策略

### 预设

预设只修改构建参数，不会创建跨平台编译环境；应用预设会覆盖对应字段，之后仍可手动修改。

| 预设 | 压缩 / 架构 | 默认目标 | 原生依赖重编译 |
| --- | --- | --- | --- |
| `release` 发布推荐 | `normal` / `x64` | Windows `nsis` | 开启 |
| `quick` 快速验证 | `store` / `x64` | Windows `portable` | 关闭 |
| `compact` 体积优先 | `maximum` / `x64` | Windows `nsis` | 开启 |
| `cross` 跨平台分发 | `normal` / `x64, arm64` | Windows `nsis, zip`；Linux `AppImage, deb`；macOS `dmg, zip` | 开启 |

四种预设均启用 `asar`。前三种仅启用 Windows；可通过「仅当前系统平台」或平台复选框修改。`buildPreset` 保存所选预设，`targetWindows`、`targetLinux`、`targetMac` 分别控制平台启用，至少选择一个平台。

### 压缩、归档与架构

- `compression`：`store` 不压缩、`normal` 标准压缩、`maximum` 最大压缩，影响构建耗时与包体积。
- `asar`：将应用文件归档为 `app.asar`，不是加密或源码保护措施；关闭时按普通文件打包。
- `npmRebuild`：是否按目标 Electron 环境重编译原生依赖；纯 HTML 模式自动关闭。
- `arches`：多个架构用逗号分隔，按所有已启用平台共同校验。Windows 支持 `x64`、`arm64`、`ia32`；Linux 支持 `x64`、`arm64`、`ia32`、`armv7l`；macOS 支持 `x64`、`arm64`、`universal`。实际可构建组合仍受 Electron 版本与目标格式限制。

`universal` 只能用于仅启用 macOS 的构建。界面通过导入或读取项目配置，也能保留下拉框没有预置的目标与架构值。

### 运行时版本

| 字段 | 行为 |
| --- | --- |
| `electronVersion` | 指定实际使用的 Electron 版本；留空优先解析项目版本，纯 HTML 模式回退到工具自带版本 |
| `chromiumVersion` | 四段版本号，通过 `CHROMIUM_VERSION` 等环境变量传入安装和构建流程 |
| `nodeVersion` | SemVer 版本，通过 `NODE_VERSION` 等环境变量传入安装和构建流程 |
| `clearRuntimeOverridesAfterBuild` | 一次构建尝试结束后清空上述三个字段，包括失败或取消的情况 |

Chromium/Node.js 覆盖值供依赖编译和自定义脚本读取，不会替换 Electron 内置的 Chromium/Node.js。Electron 与 Node.js 字段需要完整 SemVer，不能填写 `latest` 或版本范围。

版本候选从官方发布接口刷新，缓存 6 小时；网络失败时使用最近缓存或内置候选，不会覆盖已填写的版本。

## 平台与安装包

### Windows

- `winTargets`：选择 `nsis` 安装程序、`portable` 自解压包、`zip` 压缩包或其组合。
- `winPortable`：在所选目标之外追加 `portable`，不会重复添加。
- `publisherName`：传入 Windows 签名发行者设置，不会自动提供签名证书。

NSIS 安装设置仅影响安装包：

| 字段 | 说明 |
| --- | --- |
| `nsisOneClick` | 单击安装；需要选择安装目录时必须关闭 |
| `nsisPerMachine` / `nsisAllowElevation` | 为所有用户安装 / 允许请求提权 |
| `nsisAllowChangeDir` | 允许用户选择安装目录 |
| `nsisShortcutName` | 快捷方式名称，留空使用产品名称 |
| `nsisCreateDesktopShortcut` | `auto` 使用构建器默认策略、`always` 创建、`never` 不创建 |
| `nsisDeleteAppData` | 卸载时删除应用用户数据，默认关闭 |

**portable 使用方式：**

1. 将自解压 EXE 放到可写目录并运行。
2. 程序在 EXE 所在目录创建子文件夹，解压后显示提示，不自动启动应用。
3. 手动运行子文件夹内的主程序，程序文件会保留。

子文件夹名称优先取 `executableName`，再取 `productName` 或 `appId`，并替换 Windows 非法文件名字符；本工具自打包固定使用 `html2exe`。再次运行自解压包会刷新该目录，请先关闭其中的应用，不要把个人文件存放在解压目录。

### Linux 与 macOS

| 平台 | 字段 | 常用值 |
| --- | --- | --- |
| Linux | `linuxTargets` | `AppImage`、`deb`、`rpm`，可组合 |
| Linux | `linuxCategory` / `linuxMaintainer` | 应用分类 / `团队名称 <team@example.com>` |
| macOS | `macTargets` | `dmg`、`zip` 或组合 |
| macOS | `macCategory` | 例如 `public.app-category.utilities` |

Linux 系统包应填写真实的维护者、邮箱和主页。缺少时工具会写入 `example.invalid` 占位值并记录警告，正式分发前需要替换。

跨平台目标并不保证能在任意系统构建。Windows 上制作 `deb`、`rpm` 等 FPM 目标需要可用的 `fpm`，或通过 `CUSTOM_FPM_PATH` 指定；缺少时构建会提前中止。macOS 构建及签名、公证应在相应 macOS 环境完成，原生依赖也需要目标平台工具链。当前完整构建验证以 Windows 为主，其他平台和架构需要在对应环境验证。

## 窗口与图标

窗口选项仅对纯 HTML 模式生成的入口生效；已有 Electron 项目继续使用自身的窗口代码。

| 字段 | 说明 |
| --- | --- |
| `windowTitle` | 初始窗口标题 |
| `windowWidth` / `windowHeight` | 初始像素尺寸，默认 `1280 × 800`，有效范围 `1–32767` |
| `windowShowMenuBar` / `windowFrame` | 显示原生菜单 / 系统边框 |
| `windowResizable` / `windowFullscreenable` | 允许调整尺寸 / 全屏 |
| `windowAlwaysOnTop` | 始终置顶 |
| `winIcon` / `linuxIcon` / `macIcon` | Windows `.ico` 或可转换的 `.png` / Linux `.png` / macOS `.icns` |

图标相对路径基于原项目目录，只处理已选平台的图标。图标留空时使用可用的默认资源。

## 文件与资源

三个输入框均每行一条规则：字符串直接填写，对象使用单行 JSON；不要粘贴整个数组。已有 Electron 项目的路径遵循其构建配置，纯 HTML 模式的输入路径以原始 HTML 目录为基准。

`filesGlobs` 对应 `build.files`，控制应用文件，示例：

```text
**/*
!secrets.txt
!**/*.map
```

纯 HTML 模式会补齐入口与 `app-source/**`，保留排除规则；若只需要静态目录的一部分，请明确添加排除项。

`extraResources` 对应 `build.extraResources`，复制到应用资源目录，放在 asar 归档之外。重命名资源目录示例：

```json
{"from":"assets","to":"media","filter":["**/*","!**/*.psd"]}
```

已有 Electron 应用可通过 `process.resourcesPath` 定位这些文件；纯 HTML 页面没有直接访问 Node.js API 的权限，应将页面依赖的资源保留在页面可访问的相对路径中。

`asarUnpack` 对应 `build.asarUnpack`，在启用 asar 时将匹配文件放在 `app.asar.unpacked`，例如：

```text
**/*.node
```

### 纯 HTML 模式的处理规则

- 按目录层级查找入口，同层优先 `index.html`，其次其他 `.html` 文件。
- 将源文件复制到临时工程，生成独立 Electron 入口，不修改原始 HTML。
- 默认忽略 `node_modules`、`.git`、`.cache`、`release`、`dist`、`out`、`win-unpacked`、`app.asar.unpacked` 及当前输出目录。这些名称针对所选目录内部判断；可以直接选择前端生成的 `dist` 作为项目目录。
- 页面通过 `file://` 加载，应使用适合本地文件加载的资源路径和路由。依赖开发服务器或根路径 `/assets/...` 的页面需要先调整。
- 生成窗口启用 `sandbox`、`contextIsolation`，禁用 `nodeIntegration`。需要 Node.js API、preload 或自定义协议时，应提供完整 Electron 项目。
- 成功、失败与取消后统一清理临时工程；正式产物保留在设置的输出目录。

## 配置保存与缓存

「保存配置」会持久化表单；启动时恢复已保存值。「导出配置」生成 JSON 备份；「导入配置」立即应用并保存，支持导出的格式和普通配置对象，最大 1 MB。布尔字段必须使用 JSON 的 `true` / `false`。迁移到另一台电脑后需重新核对项目、输出和图标路径。

「重置配置」确认后删除已保存设置，恢复默认值，不删除源码或构建产物。

| 数据 | 位置 |
| --- | --- |
| 开发模式缓存根目录 | 仓库下 `.cache/` |
| 打包后缓存根目录 | Electron `appData/<应用名>/.cache/`；Windows 通常为 `%APPDATA%/html2exe/.cache/` |
| 配置文件 | 缓存根目录下 `electron/user-data/builder-settings.json` |
| 界面缓存 / 临时文件 / 日志 | `electron/cache/`、`electron/temp/`、`electron/logs/` |
| 构建临时文件 / 工具缓存 / Electron 下载 | `builder/temp/`、`builder/cache/`、`builder/electron-download/` |
| npm 缓存 / 后备构建器 | `builder/npm-cache/`、`builder/toolchain/` |

「清理构建缓存」清理界面及构建缓存、临时文件和日志，保留 `electron/user-data` 与 `builder/toolchain`，也不会删除 `vendor/toolchain` 或正式产物。文件被占用时重试，无法删除则报告「部分清理」；不会结束其他程序。启动时只在本应用的构建临时目录中回收历史文件。

## 常见问题

| 现象 | 处理方式 |
| --- | --- |
| 前端项目没有生成可运行应用 | 先自行编译，再选择静态产物目录；有 `package.json` 会按 Electron 项目处理 |
| 打包后页面空白或资源丢失 | 核对入口、`file://` 下的相对路径与资源排除规则；依赖服务端的功能需要单独提供服务 |
| Electron 项目依赖不完整 | 工具只检查 `node_modules` 是否存在；在目标项目中手动按锁文件重新安装依赖 |
| 下载失败或缓存损坏 | 检查网络、代理和日志中的下载地址，必要时清理构建缓存后重试；镜像配置见开发文档 |
| 工具链缺失 / portable 模板不兼容 | 源码环境执行 `npm run prebuild`；检查工具链锁文件与版本，发布版需要重新打包分发 |
| 清理提示文件被占用 | 关闭相关应用、资源管理器预览等占用后重试，依据日志中的跳过路径定位 |
| 无法选择 NSIS 安装目录 | 关闭单击安装，再启用允许选择安装目录 |
| portable 解压后没有自动打开 | 按提示手动运行解压目录内的主程序 |
