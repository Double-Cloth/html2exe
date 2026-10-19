const path = require("node:path");
const { install } = require("./fs-rename-retry");
const { installPortableTemplateOverride } = require("./portable-template");

if (process.platform === "win32") install();

const builderCliPath = process.argv[2];
if (!builderCliPath) {
  console.error("缺少 electron-builder CLI 路径。");
  process.exitCode = 1;
} else {
  if (process.env.HTML2EXE_PERSISTENT_PORTABLE === "1") installPortableTemplateOverride(builderCliPath);
  process.argv = [process.argv[0], builderCliPath, ...process.argv.slice(3)];
  require(path.resolve(builderCliPath));
}
