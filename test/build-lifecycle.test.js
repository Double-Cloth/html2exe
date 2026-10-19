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
        ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
      };
    },
  });
  vm.runInContext(fs.readFileSync(path.join(repoRoot, "main.js"), "utf8"), context);
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
  const build = context.runBuild({ projectDir: repoRoot });
  await assert.rejects(context.runBuild({ projectDir: repoRoot }), /已有构建/);
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
  const build = context.runBuild({ projectDir: repoRoot });
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
