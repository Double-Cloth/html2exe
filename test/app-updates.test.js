const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");
const { createRequire } = require("node:module");
const test = require("node:test");

const repoRoot = path.resolve(__dirname, "..");
const projectRequire = createRequire(path.join(repoRoot, "main.js"));
const latestUrl = "https://api.github.com/repos/Double-Cloth/html2exe/releases/latest";
const releaseUrl = "https://github.com/Double-Cloth/html2exe/releases/tag/v3.1.0";
const nextRelease = { tag_name: "v3.1.0", draft: false, prerelease: false };

function loadMain(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "html2exe-updates-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const requests = [];
  const dialogs = [];
  const opened = [];
  const warnings = [];
  const windows = [];
  class FakeWindow extends EventEmitter {
    constructor() {
      super();
      this.destroyed = false;
      this.webContents = new EventEmitter();
      this.webContents.setWindowOpenHandler = () => {};
      windows.push(this);
    }
    isDestroyed() { return this.destroyed; }
    loadFile() {}
  }
  const context = vm.createContext({
    console: { ...console, warn: (...args) => warnings.push(args) },
    Buffer, URL, AbortController, process, setTimeout, clearTimeout,
    __dirname: repoRoot,
    fetch: async (url, init) => {
      requests.push({ url, init });
      if (options.fetch) return options.fetch(url, init);
      return { ok: true, json: async () => options.release ?? nextRelease };
    },
    require(request) {
      if (request !== "electron") return projectRequire(request);
      return {
        app: {
          isPackaged: true, getPath: () => root, getName: () => "html2exe",
          getVersion: () => "3.0.0", getAppPath: () => repoRoot,
          setPath() {}, whenReady: () => ({ then() {} }), on() {},
        },
        BrowserWindow: FakeWindow,
        dialog: {
          showMessageBox: async (window, config) => {
            dialogs.push({ window, config });
            if (options.showMessageBox) return options.showMessageBox(window, config);
            return { response: options.response ?? 1 };
          },
        },
        shell: { openExternal: async (url) => {
          opened.push(url);
          if (options.openExternal) await options.openExternal(url);
        } },
        ipcMain: { handle() {} },
      };
    },
  });
  vm.runInContext(fs.readFileSync(path.join(repoRoot, "main.js"), "utf8"), context);
  context.createWindow();
  return { context, requests, dialogs, opened, warnings, windows };
}

test("正式版本按数值比较，兼容 tag 前缀并忽略旧版本、草稿及预发布", (t) => {
  const { context } = loadMain(t);
  for (const [tag, current, expected] of [
    ["v3.1.0", "3.0.0", "3.1.0"],
    ["3.10.0", "3.9.0", "3.10.0"],
    ["V4.0.0", "3.99.99", "4.0.0"],
    [" v3.1.0 ", "3.0.0", "3.1.0"],
    ["v3.0.0", "3.0.0-beta.1", "3.0.0"],
    ["v3.0.0", "3.0.0-beta.1+build.2", "3.0.0"],
    ["v2.0.5", "3.0.0", null],
    ["v3.0.0", "3.0.0", null],
    ["v3.0.0", "3.0.0+build.2", null],
    ["v3.9.0", "3.10.0", null],
    ["v3.0.0", "3.1.0-beta.1", null],
    ["v3.2.0-beta.1", "3.0.0", null],
    ["latest", "3.0.0", null],
    ["v3.1", "3.0.0", null],
    ["v3.1.0", "invalid", null],
    ["v999999999999999999999.0.0", "3.0.0", null],
  ]) {
    const update = context.getNewAppRelease({ ...nextRelease, tag_name: tag }, current);
    assert.equal(update && update.version, expected, `${tag} / ${current}`);
  }
  for (const release of [null, {}, [], { ...nextRelease, tag_name: 310 },
    { ...nextRelease, draft: true }, { ...nextRelease, prerelease: true }]) {
    assert.equal(context.getNewAppRelease(release, "3.0.0"), null);
  }
});

test("首次窗口准备显示后自动检查，每次进程运行只请求及提示一次", async (t) => {
  const { context, requests, dialogs, windows } = loadMain(t);
  assert.equal(requests.length, 0);
  windows[0].emit("ready-to-show");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, latestUrl);
  assert.equal(requests[0].init.headers["User-Agent"], "html2exe/3.0.0");
  assert.ok(requests[0].init.signal instanceof AbortSignal);
  assert.equal(dialogs.length, 1);
  assert.equal(dialogs[0].window, windows[0]);
  assert.match(dialogs[0].config.detail, /当前版本：3\.0\.0/);
  assert.match(dialogs[0].config.detail, /最新版本：3\.1\.0/);
  assert.equal(dialogs[0].config.defaultId, 1);
  assert.equal(dialogs[0].config.cancelId, 1);
  windows[0].emit("ready-to-show");
  await context.checkForAppUpdates();
  context.createWindow();
  windows[1].emit("ready-to-show");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests.length, 1);
  assert.equal(dialogs.length, 1);
});

test("仅确认后打开固定仓库发布页，不使用远程返回的任意地址", async (t) => {
  const { context, opened } = loadMain(t, {
    response: 0,
    release: { ...nextRelease, html_url: "file:///unsafe.exe" },
  });
  await context.checkForAppUpdates();
  assert.deepEqual(opened, [releaseUrl]);
});

test("稍后再说、关闭弹窗或没有新版本时不打开浏览器", async (t) => {
  const postponed = loadMain(t);
  await postponed.context.checkForAppUpdates();
  assert.equal(postponed.dialogs.length, 1);
  assert.deepEqual(postponed.opened, []);
  for (const tag_name of ["v2.0.5", "v3.0.0"]) {
    const unchanged = loadMain(t, { release: { ...nextRelease, tag_name } });
    await unchanged.context.checkForAppUpdates();
    assert.equal(unchanged.dialogs.length, 0);
    assert.deepEqual(unchanged.opened, []);
  }
});

test("断网、HTTP 错误及无效 JSON 静默失败，不重复请求", async (t) => {
  for (const fetch of [
    async () => { throw new Error("网络不可用"); },
    ...[403, 404, 429, 500].map((status) => async () => ({ ok: false, status })),
    async () => ({ ok: true, json: async () => { throw new SyntaxError("无效 JSON"); } }),
  ]) {
    const { context, requests, dialogs, opened, warnings } = loadMain(t, { fetch });
    await context.checkForAppUpdates();
    await context.checkForAppUpdates();
    assert.equal(requests.length, 1);
    assert.equal(warnings.length, 1);
    assert.equal(dialogs.length, 0);
    assert.deepEqual(opened, []);
  }
});

test("请求超时中止网络操作并清理定时器", async (t) => {
  const { context } = loadMain(t, {
    fetch: (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }),
  });
  let timer;
  let cleared = false;
  context.setTimeout = (callback, delay) => {
    assert.equal(delay, 8000);
    timer = setTimeout(callback, 5);
    return timer;
  };
  context.clearTimeout = (value) => { cleared = value === timer; clearTimeout(value); };
  await assert.rejects(context.fetchJsonWithTimeout(latestUrl), { name: "AbortError" });
  assert.equal(cleared, true);
});

test("请求期间关闭或替换窗口后不再弹出更新提示", async (t) => {
  for (const replace of [false, true]) {
    let finish;
    const { context, dialogs, windows } = loadMain(t, {
      fetch: () => new Promise((resolve) => { finish = resolve; }),
    });
    const checking = context.checkForAppUpdates();
    if (replace) context.createWindow();
    else { windows[0].destroyed = true; windows[0].emit("closed"); }
    finish({ ok: true, json: async () => nextRelease });
    await checking;
    assert.equal(dialogs.length, 0);
  }
});

test("对话框期间窗口关闭或浏览器启动失败时安全结束", async (t) => {
  const closed = loadMain(t, {
    showMessageBox: async (window) => {
      window.destroyed = true;
      window.emit("closed");
      return { response: 0 };
    },
  });
  await closed.context.checkForAppUpdates();
  assert.deepEqual(closed.opened, []);
  const failed = loadMain(t, {
    response: 0, openExternal: async () => { throw new Error("浏览器启动失败"); },
  });
  await assert.doesNotReject(failed.context.checkForAppUpdates());
  assert.equal(failed.warnings.length, 1);
});
