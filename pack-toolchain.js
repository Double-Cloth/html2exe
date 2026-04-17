const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const vendorDir = path.join(__dirname, 'vendor', 'toolchain');
if (fs.existsSync(vendorDir)) {
  fs.rmSync(vendorDir, { recursive: true, force: true });
}
fs.mkdirSync(vendorDir, { recursive: true });

const pkg = {
  name: "bundled-toolchain",
  version: "1.0.0",
  private: true,
  dependencies: {
    "electron-builder": "26.8.1"
  }
};
fs.writeFileSync(path.join(vendorDir, 'package.json'), JSON.stringify(pkg, null, 2));

console.log("Installing toolchain into vendor/toolchain...");
const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const installArgs = [
  "install",
  "--no-audit",
  "--no-fund",
  "--include=optional",
  "--loglevel=error"
];
cp.execSync(`${npmCmd} ${installArgs.join(" ")}`, { cwd: vendorDir, stdio: "inherit" });
