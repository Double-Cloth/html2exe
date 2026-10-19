const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { resolveNpmCli } = require("../scripts/npm-cli");
const { REQUIRED_TOOLCHAIN_FILES, TOOLCHAIN_DEPENDENCIES, isToolchainComplete } = require("../scripts/pack-toolchain");
const { installPortableTemplateOverride, resolvePortableTemplatePathFromBuilderCli } = require("../scripts/portable-template");
const selfBuild = require("../scripts/build-self");

function tempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "html2exe-tools-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test("npm 通过真实 CLI 启动，支持空格路径且无需 shell", (t) => {
  const root = tempRoot(t);
  const cli = path.join(root, "space path", "npm-cli.js");
  fs.mkdirSync(path.dirname(cli), { recursive: true });
  fs.writeFileSync(cli, "");
  assert.equal(resolveNpmCli({ bundledCli: cli, env: {}, execPath: path.join(root, "node") }), cli);
  assert.equal(resolveNpmCli({ env: {}, execPath: path.join(root, "node") }), "");
});

test("工具链完整性检查要求同时包含 npm、构建器和 rcedit", (t) => {
  const root = tempRoot(t);
  assert.ok(TOOLCHAIN_DEPENDENCIES.npm);
  for (const [name, version] of Object.entries(TOOLCHAIN_DEPENDENCIES)) {
    const dir = path.join(root, "node_modules", name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ version }));
  }
  assert.equal(isToolchainComplete(root), false);
  for (const file of REQUIRED_TOOLCHAIN_FILES) {
    const target = path.join(root, "node_modules", file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (!fs.existsSync(target)) fs.writeFileSync(target, "");
  }
  fs.copyFileSync(path.join(__dirname, "..", "scripts", "toolchain", "package-lock.json"), path.join(root, "package-lock.json"));
  assert.equal(isToolchainComplete(root), true);
});

test("portable 模板覆盖只影响构建器读取，原始依赖文件保持完整", async () => {
  const cli = require.resolve("electron-builder/cli.js");
  const template = resolvePortableTemplatePathFromBuilderCli(cli);
  const original = fs.readFileSync(template, "utf8");
  const library = require.resolve("app-builder-lib/package.json", { paths: [path.dirname(cli)] });
  const builderFs = require(require.resolve("fs-extra", { paths: [path.dirname(library)] }));
  const restore = installPortableTemplateOverride(cli);
  try {
    assert.match(await builderFs.readFile(template, "utf8"), /\$EXEDIR\\\$\{UNPACK_DIR_NAME\}/);
    assert.equal(fs.readFileSync(template, "utf8"), original);
  } finally { restore(); }
  assert.equal(await builderFs.readFile(template, "utf8"), original);
});

test("自打包发布保留 ZIP 和辅助产物，目录模式不使用临时 EXE 发布流程", async (t) => {
  const root = tempRoot(t);
  const source = path.join(root, "source");
  const destination = path.join(root, "dist");
  fs.mkdirSync(source);
  for (const name of ["app.zip", "app.exe.blockmap", "latest.yml", "builder-debug.yml"]) fs.writeFileSync(path.join(source, name), name);
  await selfBuild.publishTopLevelExecutables(source, destination, { log: false });
  assert.deepEqual(fs.readdirSync(destination).sort(), ["app.exe.blockmap", "app.zip", "latest.yml"]);
  for (const args of [["--dir"], ["--win", "--linux"], ["--config", "custom.json"], ["--config.directories.output", "custom"]]) {
    assert.equal(selfBuild.createBuildInvocation(args, { platform: "win32", projectRoot: root }).isolated, false);
  }
});

test("自打包清理拒绝经目录链接越界的路径", async (t) => {
  const root = tempRoot(t);
  const project = path.join(root, "project");
  const external = path.join(root, "external");
  fs.mkdirSync(project);
  fs.mkdirSync(path.join(external, "win-unpacked"), { recursive: true });
  fs.symlinkSync(external, path.join(project, "dist"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(selfBuild.cleanupPreBuildOutputs([], { platform: "win32", projectRoot: project }), /拒绝清理/);
  assert.equal(fs.existsSync(path.join(external, "win-unpacked")), true);
});

test("自打包发布失败后保留临时产物供恢复", async (t) => {
  const root = tempRoot(t);
  const project = path.join(root, "project");
  fs.mkdirSync(path.join(project, "dist", "sample.exe"), { recursive: true });
  const runner = path.join(root, "fake-runner.cjs");
  fs.writeFileSync(runner, `const fs = require("node:fs"); const path = require("node:path");
    const output = process.argv.find(arg => arg.startsWith("-c.directories.output=")).split("=").slice(1).join("=");
    fs.mkdirSync(output, { recursive: true }); fs.writeFileSync(path.join(output, "sample.exe"), "完整产物");`);
  const tempOutput = path.join(root, "staging");
  await assert.rejects(selfBuild.buildSelf([], { platform: "win32", projectRoot: project,
    builderCliPath: require.resolve("electron-builder/cli.js"), runnerPath: runner, cwd: project,
    selfBuildOutputRoot: tempOutput, buildId: "failed-publish", log: false }));
  assert.equal(fs.readFileSync(path.join(tempOutput, "failed-publish", "sample.exe"), "utf8"), "完整产物");
});
