const path = require("node:path");
const { install } = require("./fs-rename-retry");

install();

const builderCliPath = process.argv[2];
if (!builderCliPath) {
  console.error("缺少 electron-builder CLI 路径。");
  process.exitCode = 1;
} else {
  process.argv = [process.argv[0], builderCliPath, ...process.argv.slice(3)];
  require(path.resolve(builderCliPath));
}
