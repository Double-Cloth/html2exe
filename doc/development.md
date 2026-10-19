# 开发文档

项目使用 Electron、CommonJS、原生 HTML/CSS/JavaScript 和 electron-builder，无前端编译步骤。常用启动、测试和自打包命令见 [README](../README.md)，界面字段与使用限制见 [功能文档](guide.md)。

## 环境与目录

源码开发需要 Node.js ≥ 22.12.0 和 npm，以仓库锁文件中依赖的 `engines` 为准。首次执行 `npm ci` 会安装开发依赖并下载 Electron；`npm start` 与 `npm run dev` 等价，修改代码后需要重新启动或刷新对应页面。

```text
main.js                          主进程：路径、配置、IPC、构建与缓存管理
preload.js                       contextBridge 暴露的 builderApi
src/
  config.js                      浏览器和 CommonJS 共用的配置校验
  index.html / output.html        配置页 / 输出页
  renderer.js                    表单、预设、配置操作、构建状态和日志
  styles.css / assets/            样式与应用图标
scripts/
  build-self.js                  自打包与产物发布
  pack-toolchain.js              按独立锁文件准备内置工具链
  toolchain/package*.json        工具链依赖清单与锁文件
  npm-cli.js                     查找可由运行时直接执行的 npm-cli.js
  electron-builder-runner.js      构建子进程入口
  portable-template.js           portable 模板检查与内存替换
  fs-rename-retry.js              Windows rename 重试
  afterPack.js                   校验产物中的内置工具链
test/                            node:test 回归测试
doc/                             功能与开发文档
```

`node_modules/`、`vendor/`、`.cache/`、`dist/` 等生成目录不提交。根目录的 `package-lock.json` 与 `scripts/toolchain/package-lock.json` 都应提交。

## 进程职责与 IPC

渲染层只通过 `window.builderApi` 发起操作。`preload.js` 映射 IPC 白名单，主进程的 `registerIpcHandler` 统一校验调用者：必须来自主窗口的主框架，并位于受信任的本地配置页或输出页。

| 通道 | 职责 |
| --- | --- |
| `app:getVersion` / `runtime:getVersionOptions` | 应用版本 / 运行时版本候选 |
| `dialog:pickProject` / `dialog:pickOutput` / `dialog:pickIcon` | 本地目录和图标选择 |
| `settings:load/save/import/export/reset` | 配置读取、写入、导入、导出和重置；每项为独立通道 |
| `project:inspect` | 从项目清单或 HTML 目录读取默认值 |
| `builder:run` / `builder:cancel` | 启动 / 取消当前构建 |
| `cache:clear` | 受限范围的缓存清理 |
| `builder:log` / `builder:status` | 主进程发送日志 / 步骤与整体状态事件 |

IPC 操作通常返回 `{ success, ... }`；`builder:run` 外层表示调用结果，构建结果位于 `result`，需要同时检查 `result.success` 或 `result.canceled`。选择器、版本与配置加载接口返回其对应值，以 `preload.js` 和处理函数为准。

界面使用 CSP，禁止外部页面导航、新窗口与 webview。保持 `contextIsolation: true`、`nodeIntegration: false`，不要为增加功能扩大渲染页权限。日志订阅返回取消函数，新增生命周期逻辑时应正确释放监听。

应用更新检查完全在主进程执行：窗口首次 `ready-to-show` 后，复用带 8 秒超时的 JSON 请求访问 GitHub `Double-Cloth/html2exe` 的 `/releases/latest`。每次进程运行只检查一次，按数值比较三段正式版本号，兼容 `v` 前缀；同版本正式版高于当前预发布版，构建元数据不影响顺序。仅发现更高版本时使用原生对话框提示；用户选择前往发布页后，以固定仓库地址和编码后的 tag 构造 URL，通过 `shell.openExternal` 打开，不使用服务端返回的任意链接。网络失败仅记录到控制台，窗口关闭后不再弹窗；不新增 IPC、下载或安装逻辑。

## 配置模型与扩展方式

`src/config.js` 负责配置对象归一化与共享构建校验。已知布尔字段必须是真正的布尔值；其余支持有限数值、字符串与 `null`，归一化后为字符串。配置拒绝嵌套值及原型相关键，文件规则对象通过文本框中的单行 JSON 传递。

配置保存在应用 `userData` 中，通过队列串行更新，先写同目录临时文件，再用 rename 替换，避免并发覆盖和半写入。导出封装格式为：

```json
{
  "format": "html2exe.settings",
  "version": 1,
  "exportedAt": "2026-01-01T00:00:00.000Z",
  "settings": {
    "projectDir": "D:/projects/site",
    "outputDir": "release",
    "targetWindows": true,
    "winTargets": "portable"
  }
}
```

导入也支持直接使用 `settings` 对象；导入上限为 1 MB，支持 UTF-8 BOM。格式结构不兼容时应显式调整版本与解析逻辑。

新增配置字段时同步检查：

1. `src/index.html` 的控件、默认值、标签及说明；布局沿用现有样式。
2. `src/renderer.js` 的 `formFieldIds`、读取/应用/重置、预设及依赖控件状态。
3. `src/config.js` 的字段类型与前后端共用校验。
4. `main.js` 的 `inspectProjectDefaults` 回填、`buildTargetConfig` 映射；窗口字段还涉及生成入口。
5. 对应回归测试和功能文档。

`package.json.build` 与界面生成配置按对象递归合并，数组整体替换；未覆盖配置保留。不要假定留空字段一定删除项目原值，应核对 `buildTargetConfig` 实际生成的覆盖项。

## 图形界面的构建链路

1. 渲染层收集并校验表单，保存配置，经 IPC 请求构建。
2. `runBuild` 在首次异步操作前持有 `activeBuild`，并与 `cacheMaintenance` 互斥。
3. 核对源码及输出目录真实路径，检查宿主工具要求。输出不得覆盖源码或其祖先。
4. Electron 项目直接使用原目录；纯 HTML 项目复制到专属临时工程，生成入口、清单与必要钩子。
5. 解析 Node/Electron 运行时；按需安装项目依赖，合并构建配置、处理选中平台图标。
6. 定位构建器、生成临时配置，检查 portable 模板，通过 runner 启动构建子进程。
7. 流式回传日志与状态；子进程 `close` 时结算退出状态。
8. 成功、失败、取消统一进入 `finally`，逆序清理本次资源并释放任务锁。

取消只终止本任务拥有的进程树，Windows 使用 `taskkill /PID /T /F`，其他系统处理受管进程组。应用退出时等待取消与收尾。新增安装或打包子进程必须接入会话跟踪与取消检查，不要只在构建器启动后才支持取消。

准备失败但尚未返回的临时工程，由准备函数自行清理；已返回资源加入会话清理栈。不得按路径关键词扫描并结束其他程序，也不得扩大到系统临时目录全量清理。

日志使用 UTF-8 流解码，并保留有限尾部：主进程命令捕获约 1 MB、界面约 512 KB。关键错误应通过状态或返回值传递，不依赖无限保存完整日志。

## 内置工具链维护

根 `package.json` 定义本项目开发依赖；`scripts/toolchain/package.json` 和独立锁文件定义随应用分发的工具链。目前固定 electron-builder `26.15.3`、npm `11.21.1`、rcedit `4.0.1`。

`npm run prebuild` 在 `vendor/toolchain/` 按独立锁文件执行 `npm ci`。版本、锁文件与必需入口均匹配时直接复用。自打包通过 `extraResources` 将其复制到 `resources/embedded/toolchain/node_modules`，`afterPack` 只校验，不再重复复制。

运行时优先使用内置或本地可访问的构建器，其次使用缓存；缺失时通过可用 npm-cli 安装固定版本的 electron-builder 到应用缓存。系统没有 Node 时回退到 Electron，设置 `ELECTRON_RUN_AS_NODE=1`。所有 CLI 直接交给运行时执行，不通过 shell 启动 `npm.cmd`。

更新工具链时，先修改两份依赖清单中的对应固定版本，再在根目录更新锁文件并验证：

```bash
npm install --package-lock-only --ignore-scripts
npm install --prefix scripts/toolchain --package-lock-only --ignore-scripts
npm ci
npm run prebuild
npm test
npm audit
npm audit --prefix vendor/toolchain
```

主进程从工具链清单读取后备 builder 版本；两个清单的共享依赖应保持一致。锁文件变化会触发工具链重新安装，无需手动删除整个 `vendor/`。不要移除可选依赖安装，也不要用 `npm audit fix --force` 引入未验证的降级或不兼容覆盖。

portable 行为集中在 `portable-template.js`：先校验上游模板，再在构建子进程内拦截构建器所用的 `fs-extra.readFile`，替换读取内容。共享的 `portable.nsi` 不落盘修改；升级 builder 后必须验证模板兼容性和实际自解压行为。

自解压进度窗口由 `scripts/portable-ui.nsh` 定义，随模板一起在内存中注入，使用 NSIS 自带的现代窗口资源，不增加运行时依赖。配色遵循 `DESIGN.md`，保留目标应用图标，文件详情默认收起；窗口按对话框单位缩减日志区，跟随系统 DPI 缩放。完成提示显示实际解压目录和主程序文件名，仍需用户手动启动应用。

## 自打包与产物

`npm run build` 依次执行 `prebuild` 和 `scripts/build-self.js`，命令参数继续传给 electron-builder。默认 Windows 目标为 `portable`，其他平台使用对应配置或显式参数。

普通 Windows 文件产物先输出到系统临时目录 `html2exe-self-build/<本次构建>`，成功后将顶层产物发布到 `dist/`，包括 ZIP、blockmap、更新清单等，过滤 builder 调试与有效配置文件。发布采用临时文件复制后 rename；发布失败时保留临时产物，并在日志中输出恢复路径。

`--dir`、显式配置/输出目录、混合平台构建使用 electron-builder 原生输出方式。Windows 构建前仅清理允许范围内旧的 `dist/win-unpacked` 与 `dist/win-unpacked.tmp`，并验证目录链接的真实路径；runner 对短暂文件占用导致的 rename 失败重试。

更新应用版本时修改 `package.json` 并同步根锁文件；界面版本运行时通过 IPC 读取。发布前同时核对静态页的版本占位文案。

## 下载与宿主工具

图形界面构建默认使用 npmmirror 的 Electron 与 electron-builder 二进制镜像，继承的环境变量可以覆盖；源码依赖安装和命令行自打包遵循各自 npm / electron-builder 配置。需要为当前 PowerShell 会话显式指定时：

```powershell
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"
npm run build -- --win portable --x64 --publish never
```

这两个变量不修改 npm registry，应用的版本候选接口也仍访问官方发布源。不要把机器专用代理或凭证写入仓库。

Windows 上的 FPM 目标需要宿主可用的 `fpm` 或 `CUSTOM_FPM_PATH`。跨平台预设不会自动准备原生编译、签名、公证环境；平台相关改动应在对应系统验证。

## 测试与提交前验证

GitHub Actions 的 `.github/workflows/test.yml` 会在任意分支推送包含非文档变更时，使用 Windows 和 Node.js 24 执行 `npm ci`、`npm test`。仅修改 Markdown 文件、`doc/` 下的文件或 `LICENSE` 时跳过；代码与文档一起修改时仍运行测试。

```bash
npm test
node --test test/build-lifecycle.test.js
git diff --check
```

| 测试文件 | 关注点 |
| --- | --- |
| `config.test.js` | 字段类型、版本、架构与选项冲突 |
| `build-lifecycle.test.js` | 构建锁、取消、失败收尾与配置并发 |
| `regression.test.js` | 主进程配置、HTML 规则、路径及渲染层回归 |
| `self-build.test.js` | 自打包参数、目录清理与产物发布 |
| `toolchain.test.js` | npm 定位、工具链完整性、模板不落盘与链接边界 |
| `fs-rename-retry.test.js` | Windows rename 重试 |
| `app-updates.test.js` | 更新检测启动时机、版本比较、提示与浏览器跳转、网络失败及窗口关闭 |

单元测试通过后，按改动范围补充实际验证：

- 配置或界面：启动 Electron，检查读取、保存、导入导出、失败提示与按钮恢复；检查常规及最小窗口尺寸和页面控制台。
- HTML 与资源：用独立示例构建，启动生成应用，验证入口、交互、排除文件、附加资源和 asar 开关。
- 工具链与自打包：执行 README 中对应平台构建命令，校验内置文件；在系统 Node/npm 不可见时验证后备运行时。
- portable 与取消：确认自解压目录、手动启动、再次解压行为，检查取消后临时资源释放且依赖模板未改写。
- 平台或签名：在对应系统、架构及证书环境验证，不以 Windows 成功代替其他平台验证。

提交前检查变更范围与文档链接，不提交缓存、测试产物、机器配置或凭证。文档保留功能约定和维护方法；临时排查日志、一次性检查记录由 Git 历史或提交说明保留。
