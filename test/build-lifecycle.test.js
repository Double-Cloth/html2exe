const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const test = require("node:test");

const repoRoot = path.resolve(__dirname, "..");
const projectRequire = createRequire(path.join(repoRoot, "main.js"));

function loadMain(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "html2exe-audit-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const handlers = new Map();
  const webContents = { mainFrame: { url: require("node:url").pathToFileURL(path.join(repoRoot, "src", "index.html")).href } };
  const appEvents = new Map();
  const context = vm.createContext({
    console, Buffer, URL, AbortController, fetch, process, setTimeout, clearTimeout,
    __dirname: repoRoot,
    require(request) {
      if (request !== "electron") return projectRequire(request);
      return {
        app: {
          isPackaged: true, getPath: () => root, getName: () => "html2exe",
          getAppPath: () => repoRoot, setPath() {}, whenReady: () => ({ then() {} }),
          on: (name, listener) => appEvents.set(name, listener), quit() {},
        },
        BrowserWindow: function () {}, dialog: {},
        ipcMain: { handle: (name, handler) => handlers.set(name, (_event, ...args) => handler({ sender: webContents, senderFrame: webContents.mainFrame }, ...args)) },
      };
    },
  });
  vm.runInContext(fs.readFileSync(path.join(repoRoot, "main.js"), "utf8"), context);
  context.__webContents = webContents;
  vm.runInContext("mainWindow = { webContents: __webContents }", context);
  return { context, handlers, root, appEvents };
}

test("准备阶段占用任务锁，取消后释放锁并仅清理一次", async (t) => {
  const { context, handlers } = loadMain(t);
  let resume;
  let cleanups = 0;
  context.executeBuild = async (_form, _log, _status, session) => {
    session.cleanups.push(async () => { cleanups += 1; });
    await new Promise((resolve) => { resume = resolve; });
    context.assertBuildNotCanceled(session);
  };
  const build = context.runBuild({ projectDir: repoRoot, targetWindows: true });
  await assert.rejects(context.runBuild({ projectDir: repoRoot, targetWindows: true }), /已有构建/);
  assert.equal((await handlers.get("cache:clear")()).success, false);
  assert.equal((await handlers.get("builder:cancel")()).success, true);
  resume();
  assert.equal((await build).canceled, true);
  assert.equal(cleanups, 1);
  assert.equal(vm.runInContext("activeBuild", context), null);
});

test("准备失败时删除尚未返回的临时工程", async (t) => {
  const { context, root } = loadMain(t);
  const source = path.join(root, "source");
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, "index.html"), "<h1>测试</h1>");
  await assert.rejects(context.prepareWorkspaceForBuild({ projectDir: source, winIcon: "missing.ico" }, () => {}), /复制图标失败/);
  const tempRoot = vm.runInContext("CACHE_PATHS.builderTemp", context);
  assert.deepEqual(fs.readdirSync(tempRoot), []);
});

test("启动失败只报告一次，信号退出不会被当作成功", async (t) => {
  const { context } = loadMain(t);
  const failed = await context.runCommandCapture(path.join(os.tmpdir(), "html2exe-no-such-command"), []);
  assert.notEqual(failed.code, 0);
  assert.ok(failed.launchError);
  const killed = await context.runCommandCapture(process.execPath, ["-e", "process.kill(process.pid, 'SIGKILL')"]);
  assert.notEqual(killed.code, 0);
});

test("取消仅终止本次构建拥有的进程树", async (t) => {
  const { context, handlers, root } = loadMain(t);
  const ready = path.join(root, "ready");
  context.executeBuild = async (_form, _log, _status, session) => {
    await context.runCommandCapture(process.execPath, ["-e", `require('node:fs').writeFileSync(${JSON.stringify(ready)}, 'ok'); setInterval(() => {}, 1000)`], { buildSession: session });
    context.assertBuildNotCanceled(session);
  };
  const build = context.runBuild({ projectDir: repoRoot, targetWindows: true });
  const deadline = Date.now() + 5000;
  while (!fs.existsSync(ready) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(fs.existsSync(ready));
  assert.equal((await handlers.get("builder:cancel")()).success, true);
  assert.equal((await build).canceled, true);
});

test("缓存清理只枚举应用自己的临时目录", async (t) => {
  const { context, root } = loadMain(t);
  const tempRoot = vm.runInContext("CACHE_PATHS.builderTemp", context);
  const owned = path.join(tempRoot, "electron-html-pack-stale");
  const unrelated = path.join(root, "electron-html-pack-unrelated");
  fs.mkdirSync(owned);
  fs.mkdirSync(unrelated);
  await context.cleanupLegacyTempArtifacts();
  assert.equal(fs.existsSync(owned), false);
  assert.equal(fs.existsSync(unrelated), true);
});

test("并发配置保存保留全部增量字段，并拒绝伪布尔值", async (t) => {
  const { context, handlers } = loadMain(t);
  const save = handlers.get("settings:save");
  await Promise.all([save(null, { productName: "并发测试" }), save(null, { author: "团队" }), save(null, { asar: false })]);
  const saved = await context.readSettings();
  assert.equal(saved.productName, "并发测试");
  assert.equal(saved.author, "团队");
  assert.equal(saved.asar, false);
  await assert.rejects(save(null, { asar: "false" }), /布尔值/);
  await save(null, { description: "失败后可以继续保存" });
  assert.equal((await context.readSettings()).productName, "并发测试");
});

test("输出目录拒绝源码本身、祖先和指向源码的目录链接", async (t) => {
  const { context, root } = loadMain(t);
  const source = path.join(root, "source");
  const alias = path.join(root, "alias");
  fs.mkdirSync(source);
  fs.symlinkSync(source, alias, process.platform === "win32" ? "junction" : "dir");
  for (const outputDir of [source, root, alias]) {
    await assert.rejects(context.validateBuildDirectories({ projectDir: source, outputDir }), /输出目录不能/);
  }
  assert.equal(await context.validateBuildDirectories({ projectDir: source, outputDir: "release" }), path.join(source, "release"));
});

test("纯 HTML 路径过滤不受上级 dist 目录影响，并保留排除规则", async (t) => {
  const { context, root } = loadMain(t);
  const source = path.join(root, "dist", "site");
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, "index.html"), "<h1>可运行</h1>");
  assert.equal(context.shouldSkipHtmlCopyPath(source, "", path.join(source, "index.html")), false);
  assert.equal(context.shouldSkipHtmlCopyPath(source, "", path.join(source, ".cache")), true);
  assert.match(context.normalizeHtmlOnlyFilesGlobs("**/*\n!secrets/**"), /!app-source\/secrets\/\*\*/);
  const prepared = await context.prepareWorkspaceForBuild({ projectDir: source, asar: false, extraResources: '{"from":"assets","to":"media"}' }, () => {});
  t.after(prepared.cleanup);
  assert.equal(fs.existsSync(path.join(prepared.projectDir, "app-source", "index.html")), true);
  assert.equal(prepared.normalizedForm.asar, false);
  const resources = context.parseLineItems(prepared.normalizedForm.extraResources);
  assert.equal(resources[0].from, path.join(source, "assets"));
  const generatedMain = fs.readFileSync(path.join(prepared.projectDir, "main.js"), "utf8");
  assert.doesNotThrow(() => new vm.Script(generatedMain));
  assert.match(generatedMain, /app.on\("activate"/);
});

test("资源规则格式错误时给出明确错误，配置导入兼容 BOM", (t) => {
  const { context } = loadMain(t);
  assert.throws(() => context.parseLineItems('{"from":}'), /JSON 无效/);
  assert.throws(() => context.parseLineItems('["assets"]'), /不支持嵌套数组/);
  assert.equal(context.parseSettingsExport('\uFEFF{"productName":"中文"}').productName, "中文");
  assert.throws(() => context.parseSettingsExport('{"__proto__":"bad"}'), /不受支持/);
});

test("界面覆盖构建参数时保留项目钩子、资源和签名设置", (t) => {
  const { context } = loadMain(t);
  const merged = context.mergeBuildConfig({ afterPack: "./custom-hook.cjs", win: { signAndEditExecutable: false, icon: "custom.ico" }, extraResources: ["assets"] },
    context.buildTargetConfig({ productName: "新名称", asar: false }));
  assert.equal(merged.afterPack, "./custom-hook.cjs");
  assert.equal(merged.win.signAndEditExecutable, false);
  assert.equal(merged.win.icon, "custom.ico");
  assert.equal(merged.extraResources[0], "assets");
  assert.equal(merged.asar, false);
});

test("特权 IPC 拒绝远程页面和子框架", (t) => {
  const { context } = loadMain(t);
  const sender = context.__webContents;
  assert.doesNotThrow(() => context.validateIpcSender({ sender, senderFrame: sender.mainFrame }));
  assert.throws(() => context.validateIpcSender({ sender, senderFrame: { url: sender.mainFrame.url } }), /非应用页面/);
  sender.mainFrame.url = "https://example.com";
  assert.throws(() => context.validateIpcSender({ sender, senderFrame: sender.mainFrame }), /非应用页面/);
});
