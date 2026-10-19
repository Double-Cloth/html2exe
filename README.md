# html2exe

基于 Electron 的图形化打包工具，将已有 Electron 项目或纯 HTML 目录封装成桌面应用。支持 Windows、Linux、macOS 目标配置、构建预设、资源规则、配置导入导出、实时日志与取消构建。

## 快速开始

源码运行需要 Node.js ≥ 22.12.0 和 npm，首次安装需要网络。在项目根目录执行：

```bash
npm ci
npm start
```

选择项目目录并读取项目信息，调整平台、图标和输出设置，再点击「前往输出页面 → 开始打包」。默认输出到所选项目的 `release/`。

纯 HTML 目录无需 `package.json`；已有 Electron 项目需要有效的入口和构建产物。前端项目请先自行编译，再选择生成的静态目录。

## 常用命令

以下构建命令用于打包 **html2exe 本身**；打包其他项目请使用图形界面。

| 用途 | 命令 |
| --- | --- |
| 按锁文件安装依赖 | `npm ci` |
| 启动应用 | `npm start` |
| 开发启动（与 start 等价，无热更新） | `npm run dev` |
| 运行全部测试 | `npm test` |
| 运行单个测试文件 | `node --test test/config.test.js` |
| 准备内置工具链（完整时复用） | `npm run prebuild` |
| 按当前系统构建（Windows 默认为 portable） | `npm run build` |
| Windows x64 自解压 EXE | `npm run build -- --win portable --x64 --publish never` |
| Windows x64 安装包和 ZIP | `npm run build -- --win nsis zip --x64 --publish never` |
| Windows 目录产物，跳过安装包制作 | `npm run build -- --win --x64 --dir --publish never` |
| Linux x64 AppImage | `npm run build -- --linux AppImage --x64 --publish never` |
| macOS ARM64 DMG 和 ZIP | `npm run build -- --mac dmg zip --arm64 --publish never` |
| 自定义输出目录 | `npm run build -- --win portable --x64 -c.directories.output=out --publish never` |
| 检查项目依赖安全告警 | `npm audit` |
| 检查内置工具链安全告警（先执行 prebuild） | `npm audit --prefix vendor/toolchain` |

`build` 自动执行 `prebuild`，产物默认位于 `dist/`。`--` 后的参数传给 electron-builder，`--publish never` 禁止自动发布。不同平台仍需要对应的宿主系统与构建工具，详见功能文档。

Windows `portable` 为自解压包：运行后解压到 EXE 所在目录的子文件夹，**需要手动启动其中的应用**；再次解压会刷新该目录。

## 文档

- [功能文档](doc/guide.md)：项目要求、配置说明、资源示例、缓存与常见问题。
- [开发文档](doc/development.md)：代码结构、构建链路、工具链维护、测试与发布验证。

## 许可证

[MIT](LICENSE)
