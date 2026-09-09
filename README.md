# html2exe

`html2exe` 是一个基于 Electron 的桌面打包工具，用于把已有 Electron 项目或纯 HTML 目录快速封装成桌面应用。

它把 `electron-builder` 的常用配置、平台目标、输出策略、日志反馈和工具链缓存整合到图形界面中，减少手写配置和命令行操作。

## 主要能力

- 支持 Electron 项目和纯 HTML 目录打包。
- 支持 Windows、Linux、macOS 目标配置。
- 支持 Windows `nsis`、`portable`、`zip` 等常用输出。
- 支持构建预设、架构、压缩、asar、资源规则等配置。
- 支持保存、导入、导出和重置打包配置。
- 支持实时日志、构建步骤状态、取消操作和缓存清理。
- 内置并缓存 `electron-builder` 与 `npm`，降低目标机器环境依赖。

## 快速开始

```bash
npm install
npm run start
```

`npm run dev` 与 `npm run start` 等价，都会启动 Electron 应用。

## 常用命令

```bash
npm test
npm run build
```

- `npm test`：运行 `node:test` 回归测试。
- `npm run build`：构建当前工具本身，默认生成 Windows `portable` 产物（自打包）。

## 基本使用流程

1. 选择项目目录和输出目录。
2. 填写应用名称、版本、作者、应用 ID 等基础信息。
3. 选择构建预设或手动调整平台、架构和资源规则。
4. 点击读取项目信息，让工具自动回填可识别配置。
5. 切换到输出页，点击开始打包并查看实时日志。

## 详细文档

完整配置说明、纯 HTML 自动补全、工具链缓存、构建链路和常见问题见：

- [doc/guide.md](doc/guide.md)

## 许可证

MIT
