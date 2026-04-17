const fs = require("node:fs");
const path = require("node:path");

function copyToolchain(sourceRoot, destinationRoot) {
  if (!fs.existsSync(sourceRoot)) {
    return false;
  }

  fs.mkdirSync(path.dirname(destinationRoot), { recursive: true });
  fs.rmSync(destinationRoot, { recursive: true, force: true });
  fs.cpSync(sourceRoot, destinationRoot, { recursive: true, force: true });
  return true;
}

exports.default = async function afterPack(context) {
  const projectDir = context.packager.projectDir;
  const appOutDir = context.appOutDir;
  const resourcesDir = path.join(appOutDir, "resources");
  const destinationRoots = [
    path.join(resourcesDir, "embedded", "toolchain", "node_modules"),
    path.join(resourcesDir, "app", "embedded", "toolchain", "node_modules"),
  ];

  const bundledToolchain = path.join(projectDir, "vendor", "toolchain", "node_modules");

  let copied = false;
  for (const destinationRoot of destinationRoots) {
    if (copyToolchain(bundledToolchain, destinationRoot)) {
      console.log(`[afterPack] bundled toolchain copied to ${destinationRoot}`);
      copied = true;
    }
  }

  if (copied) {
    return;
  }

  throw new Error(
    "无法找到可打包的 toolchain：vendor/toolchain/node_modules 不存在，且 project/node_modules 中也没有 electron-builder/npm。请先执行 prebuild 并确保依赖安装完成。"
  );
};
