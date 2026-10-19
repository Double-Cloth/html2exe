const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { resolveNpmCli } = require("./npm-cli");

const TOOLCHAIN_DEPENDENCIES = require("./toolchain/package.json").dependencies;
const TOOLCHAIN_LOCK_PATH = path.join(__dirname, "toolchain", "package-lock.json");
const REQUIRED_TOOLCHAIN_FILES = ["electron-builder/cli.js", "app-builder-lib/package.json", "npm/bin/npm-cli.js", "rcedit/bin/rcedit.exe"];

function isToolchainComplete(vendorDir) {
  try {
    return fs.readFileSync(path.join(vendorDir, "package-lock.json"), "utf8") === fs.readFileSync(TOOLCHAIN_LOCK_PATH, "utf8") &&
      Object.entries(TOOLCHAIN_DEPENDENCIES).every(([name, version]) =>
      JSON.parse(fs.readFileSync(path.join(vendorDir, "node_modules", name, "package.json"), "utf8")).version === version) &&
      REQUIRED_TOOLCHAIN_FILES.every((file) => fs.existsSync(path.join(vendorDir, "node_modules", file)));
  } catch (error) { return false; }
}

function packToolchain(projectRoot = path.resolve(__dirname, "..")) {
  const vendorDir = path.join(projectRoot, "vendor", "toolchain");
  if (isToolchainComplete(vendorDir)) {
    console.log("内置工具链完整，跳过重复安装。");
    return;
  }
  const npmCli = resolveNpmCli();
  if (!npmCli) throw new Error("未找到 npm-cli，无法准备内置工具链。");
  fs.mkdirSync(vendorDir, { recursive: true });
  fs.writeFileSync(path.join(vendorDir, "package.json"), JSON.stringify({
    name: "bundled-toolchain", version: "1.0.0", private: true, dependencies: TOOLCHAIN_DEPENDENCIES,
  }, null, 2));
  fs.copyFileSync(TOOLCHAIN_LOCK_PATH, path.join(vendorDir, "package-lock.json"));
  console.log("正在按锁文件准备内置 electron-builder、npm 和 rcedit...");
  const result = spawnSync(process.execPath, [npmCli, "ci", "--no-audit", "--no-fund", "--include=optional", "--loglevel=error"], {
    cwd: vendorDir, stdio: "inherit", windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 || !isToolchainComplete(vendorDir)) throw new Error(`内置工具链安装失败，退出码: ${result.status}`);
}

if (require.main === module) {
  try { packToolchain(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { TOOLCHAIN_DEPENDENCIES, REQUIRED_TOOLCHAIN_FILES, isToolchainComplete, packToolchain };
