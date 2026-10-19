const fs = require("node:fs");
const path = require("node:path");
const { REQUIRED_TOOLCHAIN_FILES } = require("./pack-toolchain");

exports.default = async function afterPack(context) {
  // extraResources 已在 afterPack 前复制完成；只校验，避免把工具链重复打包三份。
  const resourcesDir = context.packager.getResourcesDir(context.appOutDir);
  const toolchainRoot = path.join(resourcesDir, "embedded", "toolchain", "node_modules");
  const missing = REQUIRED_TOOLCHAIN_FILES.filter((file) => !fs.existsSync(path.join(toolchainRoot, file)));
  if (missing.length) throw new Error(`内置工具链不完整，请先执行 npm run prebuild。缺少: ${missing.join(", ")}`);
  console.log(`[afterPack] 内置工具链校验通过: ${toolchainRoot}`);
};
