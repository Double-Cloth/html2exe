const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const repoRoot = path.resolve(__dirname, "..");

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(...names) {
    names.forEach((name) => this.values.add(name));
  }

  remove(...names) {
    names.forEach((name) => this.values.delete(name));
  }

  toggle(name, force) {
    if (force) {
      this.add(name);
      return true;
    }
    this.remove(name);
    return false;
  }
}

class FakeElement {
  constructor(id = "") {
    this.id = id;
    this.dataset = {};
    this.classList = new FakeClassList();
    this.disabled = false;
    this.readOnly = false;
    this.type = "button";
    this.value = "";
    this.checked = false;
    this.defaultValue = "";
    this.defaultChecked = false;
    this.scrollTop = 0;
    this.scrollHeight = 0;
    this.listeners = new Map();
    this._innerHTML = "";
    this._textContent = "";
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(value) {
    this._innerHTML = String(value || "");
    this._textContent = this._innerHTML.replace(/<[^>]*>/g, "");
  }

  get textContent() {
    return this._textContent;
  }

  set textContent(value) {
    this._textContent = String(value || "");
    this._innerHTML = this._textContent;
  }

  addEventListener(type, callback) {
    this.listeners.set(type, callback);
  }

  querySelectorAll() {
    return [];
  }

  querySelector() {
    return null;
  }
}

function createDocument(elements) {
  return {
    getElementById(id) {
      return elements.get(id) || null;
    },
    querySelectorAll() {
      return [];
    },
    querySelector() {
      return null;
    },
    addEventListener() {},
  };
}

function loadRendererContext() {
  const elements = new Map();
  const logOutput = new FakeElement("logOutput");
  logOutput.textContent = "打包器已就绪待命中，随时候命...";
  elements.set("logOutput", logOutput);

  const actionFeedback = new FakeElement("actionFeedback");
  elements.set("actionFeedback", actionFeedback);

  const context = {
    console,
    setTimeout,
    clearTimeout,
    navigator: { platform: "Win32" },
    document: createDocument(elements),
    window: {
      location: { href: "" },
      builderApi: {
        loadSettings: async () => ({}),
        onLog: () => () => {},
        onStatus: () => () => {},
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(repoRoot, "src", "renderer.js"), "utf-8"), context);
  context.__elements = elements;
  return context;
}

function loadMainContext() {
  const handlers = new Map();
  const dialog = {};
  const context = {
    console,
    Buffer,
    process,
    setTimeout,
    clearTimeout,
    __dirname: repoRoot,
    require(request) {
      if (request === "electron") {
        return {
          app: {
            isPackaged: false,
            getPath: (name) => path.join(repoRoot, ".test-cache", name),
            setPath: () => {},
            getName: () => "html2exe",
            getAppPath: () => repoRoot,
            whenReady: () => ({ then: () => {} }),
            on: () => {},
            quit: () => {},
          },
          BrowserWindow: function BrowserWindow() {},
          dialog,
          ipcMain: {
            handle: (name, handler) => handlers.set(name, handler),
          },
        };
      }
      return require(request);
    },
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(repoRoot, "main.js"), "utf-8"), context);
  context.__handlers = handlers;
  context.__dialog = dialog;
  return context;
}

test("首次追加日志时会清理输出页初始占位文本", () => {
  const context = loadRendererContext();

  context.appendLog("准备开始打包...\n");

  const text = context.__elements.get("logOutput").textContent;
  assert.match(text, /准备开始打包/);
  assert.doesNotMatch(text, /打包器已就绪待命中/);
});

test("运行时版本字段自动保存时会保留当前表单的其它设置", async () => {
  const context = loadRendererContext();
  let savedPayload = null;

  const textField = (id, value) => {
    const el = new FakeElement(id);
    el.type = "text";
    el.value = value;
    context.__elements.set(id, el);
    return el;
  };

  const checkboxField = (id, checked) => {
    const el = new FakeElement(id);
    el.type = "checkbox";
    el.checked = checked;
    context.__elements.set(id, el);
    return el;
  };

  textField("productName", "新应用");
  textField("electronVersion", "41.2.0");
  textField("chromiumVersion", "134.0.6998");
  textField("nodeVersion", "22.13.1");
  checkboxField("clearRuntimeOverridesAfterBuild", true);
  checkboxField("targetLinux", true);

  context.window.builderApi.saveSettings = async (payload) => {
    savedPayload = payload;
    return { success: true };
  };

  await context.saveRuntimeOverridesSnapshot();

  assert.ok(savedPayload);
  assert.equal(savedPayload.productName, "新应用");
  assert.equal(savedPayload.targetLinux, true);
  assert.equal(savedPayload.electronVersion, "41.2.0");
  assert.equal(savedPayload.chromiumVersion, "134.0.6998");
  assert.equal(savedPayload.nodeVersion, "22.13.1");
  assert.equal(savedPayload.clearRuntimeOverridesAfterBuild, true);
});

test("按钮忙碌状态结束后会恢复原始图标和文案", () => {
  const context = loadRendererContext();
  const button = new FakeElement("saveConfigBtn");
  button.innerHTML = '<svg class="icon"></svg> 保存当前配置';
  const originalHtml = button.innerHTML;

  context.setButtonBusy(button, true, "保存中...", "保存当前配置");
  context.setButtonBusy(button, false);

  assert.equal(button.innerHTML, originalHtml);
});

test("默认 macOS 图标不会回退到 PNG 文件", () => {
  const context = loadMainContext();

  const defaults = context.getDefaultFormSettings();

  assert.ok(!defaults.macIcon || defaults.macIcon.toLowerCase().endsWith(".icns"));
});

test("开发环境可以定位随项目安装的 rcedit", () => {
  const context = loadMainContext();
  const rceditPath = context.resolveBundledRceditBinaryPath();

  assert.ok(rceditPath, "应能定位 rcedit.exe");
  assert.equal(path.basename(rceditPath).toLowerCase(), "rcedit.exe");
  assert.equal(fs.existsSync(rceditPath), true);
});

test("配置导出格式可以完整解析并保留字段", () => {
  const context = loadMainContext();
  const exported = context.createSettingsExport({
    productName: "示例应用",
    asar: true,
  });

  const settings = context.parseSettingsExport(JSON.stringify(exported));

  assert.deepEqual(JSON.parse(JSON.stringify(settings)), {
    productName: "示例应用",
    asar: true,
  });
});

test("配置导入会拒绝不受支持的嵌套值", () => {
  const context = loadMainContext();

  assert.throws(
    () => context.parseSettingsExport(JSON.stringify({ productName: { nested: true } })),
    /值类型不受支持/
  );
});

test("配置导入导出 IPC 可以完成 JSON 文件往返", async () => {
  const context = loadMainContext();
  const tempDir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "html2exe-config-test-"));
  const configPath = path.join(tempDir, "shared-config.json");

  try {
    context.__dialog.showSaveDialog = async () => ({ canceled: false, filePath: configPath });
    const exportResult = await context.__handlers.get("settings:export")(null, {
      productName: "往返测试",
      targetWindows: true,
    });
    assert.equal(exportResult.success, true);

    context.__dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [configPath],
    });
    const importResult = await context.__handlers.get("settings:import")();

    assert.equal(importResult.success, true);
    assert.deepEqual(JSON.parse(JSON.stringify(importResult.settings)), {
      productName: "往返测试",
      targetWindows: true,
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("重置表单会恢复默认预设并应用主进程动态默认值", () => {
  const context = loadRendererContext();
  const productName = new FakeElement("productName");
  productName.type = "text";
  productName.defaultValue = "";
  productName.value = "旧应用";
  context.__elements.set("productName", productName);

  const compression = new FakeElement("compression");
  compression.type = "select-one";
  compression.defaultValue = "normal";
  compression.value = "maximum";
  context.__elements.set("compression", compression);

  const electronVersion = new FakeElement("electronVersion");
  electronVersion.type = "text";
  electronVersion.value = "旧版本";
  context.__elements.set("electronVersion", electronVersion);

  context.resetFormToDefaults({ electronVersion: "41.2.1" });

  assert.equal(productName.value, "");
  assert.equal(compression.value, "normal");
  assert.equal(electronVersion.value, "41.2.1");
});

test("历史临时目录枚举失败时返回空清理结果", async () => {
  const context = loadMainContext();
  const fsp = require("node:fs/promises");
  const originalReaddir = fsp.readdir;
  fsp.readdir = async () => {
    throw new Error("tmp unavailable");
  };

  try {
    const result = await context.cleanupLegacyTempArtifacts();

    assert.deepEqual(JSON.parse(JSON.stringify(result)), {
      skipped: [],
      autoRecovered: 0,
      killedProcesses: 0,
      unlockedBy: [],
    });
  } finally {
    fsp.readdir = originalReaddir;
  }
});

test("Windows portable target uses a stable same-name unpack directory", () => {
  const context = loadMainContext();

  const config = context.buildTargetConfig({
    productName: "我的 应用",
    winTargets: "portable",
    winPortable: false,
    compression: "normal",
    asar: true,
    npmRebuild: false,
  });

  assert.deepEqual(JSON.parse(JSON.stringify(config.win.target)), ["portable"]);
  assert.equal(config.portable.unpackDirName, "我的 应用");
});

test("Windows portable unpack directory avoids reserved device names", () => {
  const context = loadMainContext();

  const config = context.buildTargetConfig({
    executableName: "CON",
    productName: "PRN.txt",
    winTargets: "portable",
    winPortable: false,
    compression: "normal",
    asar: true,
    npmRebuild: false,
  });

  assert.equal(config.portable.unpackDirName, "CON-app");
});

test("Windows publisher name is emitted under signtool options", () => {
  const context = loadMainContext();

  const config = context.buildTargetConfig({
    publisherName: "Acme Corp",
    compression: "normal",
    asar: true,
    npmRebuild: false,
  });

  assert.equal(Object.hasOwn(config.win, "publisherName"), false);
  assert.deepEqual(JSON.parse(JSON.stringify(config.win.signtoolOptions)), {
    publisherName: "Acme Corp",
  });
});

test("custom organization is emitted as author metadata object", () => {
  const context = loadMainContext();

  const config = context.buildTargetConfig({
    version: "1.2.3",
    author: "Acme Corp",
    description: "Desktop packaging tool",
    compression: "normal",
    asar: true,
    npmRebuild: false,
  });

  assert.deepEqual(JSON.parse(JSON.stringify(config.extraMetadata)), {
    version: "1.2.3",
    author: {
      name: "Acme Corp",
    },
    description: "Desktop packaging tool",
  });
});

test("Linux package metadata includes homepage, author email, and maintainer", () => {
  const context = loadMainContext();

  const config = context.buildTargetConfig({
    version: "1.2.3",
    author: "Acme Corp",
    authorEmail: "release@acme.example",
    homepage: "https://acme.example/desktop",
    linuxTargets: "deb",
    linuxMaintainer: "Acme Release Team <release@acme.example>",
    compression: "normal",
    asar: true,
    npmRebuild: false,
  });

  assert.deepEqual(JSON.parse(JSON.stringify(config.extraMetadata.author)), {
    name: "Acme Corp",
    email: "release@acme.example",
  });
  assert.equal(config.extraMetadata.homepage, "https://acme.example/desktop");
  assert.equal(config.linux.maintainer, "Acme Release Team <release@acme.example>");
});

test("FPM targets receive reserved placeholder metadata when optional fields are blank", () => {
  const context = loadMainContext();
  const logs = [];

  const normalized = context.normalizeLinuxPackageMetadata(
    {
      targetLinux: true,
      linuxTargets: "AppImage, deb",
      productName: "Whalgebra",
      author: "",
      authorEmail: "",
      homepage: "",
    },
    { name: "whalgebra" },
    (message) => logs.push(message)
  );

  assert.equal(normalized.author, "Whalgebra");
  assert.equal(normalized.authorEmail, "noreply@example.invalid");
  assert.equal(normalized.homepage, "https://example.invalid/whalgebra");
  assert.equal(normalized.linuxMaintainer, "Whalgebra <noreply@example.invalid>");
  assert.match(logs.join(""), /已使用 example\.invalid 占位元数据/);
});

test("FPM targets preserve manifest homepage and author email", () => {
  const context = loadMainContext();
  const logs = [];

  const normalized = context.normalizeLinuxPackageMetadata(
    {
      targetLinux: true,
      linuxTargets: "rpm",
      author: "",
      authorEmail: "",
      homepage: "",
    },
    {
      name: "desktop-app",
      author: "Release Team <release@example.com>",
      homepage: "https://example.com/desktop-app",
    },
    (message) => logs.push(message)
  );

  assert.equal(normalized.author, "Release Team");
  assert.equal(normalized.authorEmail, "release@example.com");
  assert.equal(normalized.homepage, "https://example.com/desktop-app");
  assert.equal(normalized.linuxMaintainer, "Release Team <release@example.com>");
  assert.deepEqual(logs, []);
});

test("Windows builds reject FPM Linux targets before electron-builder starts", () => {
  const context = loadMainContext();

  assert.throws(
    () =>
      context.assertFpmAvailableForBuild(
        {
          targetLinux: true,
          linuxTargets: "AppImage, deb, rpm",
        },
        {
          platform: "win32",
          env: {},
          commandExists: () => false,
        }
      ),
    /Windows.*deb, rpm.*未检测到 fpm/
  );
});

test("Windows builds accept FPM targets when a custom executable exists", () => {
  const context = loadMainContext();

  assert.doesNotThrow(() =>
    context.assertFpmAvailableForBuild(
      {
        targetLinux: true,
        linuxTargets: "deb",
      },
      {
        platform: "win32",
        env: { CUSTOM_FPM_PATH: __filename },
        commandExists: () => false,
      }
    )
  );
});

test("FPM preflight does not affect non-FPM or native Linux builds", () => {
  const context = loadMainContext();
  const missingCommand = () => false;

  assert.doesNotThrow(() =>
    context.assertFpmAvailableForBuild(
      { targetLinux: true, linuxTargets: "AppImage" },
      { platform: "win32", env: {}, commandExists: missingCommand }
    )
  );
  assert.doesNotThrow(() =>
    context.assertFpmAvailableForBuild(
      { targetLinux: true, linuxTargets: "deb" },
      { platform: "linux", env: {}, commandExists: missingCommand }
    )
  );
});

test("portable template patch is only needed for Windows portable builds", () => {
  const context = loadMainContext();
  const config = context.buildTargetConfig({
    productName: "Portable App",
    winTargets: "portable",
    winPortable: false,
    compression: "normal",
    asar: true,
    npmRebuild: false,
  });

  assert.equal(
    context.shouldPatchPersistentPortableTemplate(
      { targetWindows: false, targetLinux: true, targetMac: false },
      config,
      "win32"
    ),
    false
  );
  assert.equal(
    context.shouldPatchPersistentPortableTemplate(
      { targetWindows: true, targetLinux: false, targetMac: false },
      config,
      "linux"
    ),
    true
  );
  assert.equal(
    context.shouldPatchPersistentPortableTemplate(
      { targetWindows: false, targetLinux: false, targetMac: false },
      config,
      "win32"
    ),
    true
  );
});

test("persistent portable NSIS script extracts beside exe and keeps files after exit", () => {
  const context = loadMainContext();
  const template = [
    "AutoCloseWindow True",
    "RequestExecutionLevel ${REQUEST_EXECUTION_LEVEL}",
    "Function .onInit",
    "  !ifndef SPLASH_IMAGE",
    "    SetSilent silent",
    "  !endif",
    "FunctionEnd",
    "Section",
    ' StrCpy $INSTDIR "$PLUGINSDIR\\app"',
    " !ifdef UNPACK_DIR_NAME",
    ' StrCpy $INSTDIR "$TEMP\\${UNPACK_DIR_NAME}"',
    " !endif",
    " RMDir /r $INSTDIR",
    " SetOutPath $INSTDIR",
    ' ExecWait "$INSTDIR\\${APP_EXECUTABLE_FILENAME} $R0" $0',
    " SetErrorLevel $0",
    " SetOutPath $EXEDIR",
    " RMDir /r $INSTDIR",
    "SectionEnd",
  ].join("\n");

  const patched = context.createPersistentPortableNsiScript(template);

  assert.match(patched, /LoadLanguageFile "\$\{NSISDIR\}\\Contrib\\Language files\\English\.nlf"/);
  assert.match(patched, /ShowInstDetails show/);
  assert.match(patched, /Page instfiles/);
  assert.doesNotMatch(patched, /SetSilent silent/);
  assert.match(patched, /\$EXEDIR\\\$\{UNPACK_DIR_NAME\}/);
  assert.doesNotMatch(patched, /\$TEMP\\\$\{UNPACK_DIR_NAME\}/);
  assert.doesNotMatch(patched, /ExecWait "\$INSTDIR\\\$\{APP_EXECUTABLE_FILENAME\}/);
  assert.doesNotMatch(patched, /SetErrorLevel \$0/);
  assert.match(patched, /RMDir \/r "\$PLUGINSDIR"/);
  assert.match(patched, /MessageBox MB_OK "Extraction complete\."/);
  assert.doesNotMatch(patched, /[\u4e00-\u9fff]/);
  assert.match(patched, /persistent portable mode keeps unpacked files/);
  assert.equal((patched.match(/RMDir \/r \$INSTDIR/g) || []).length, 1);
});

test("persistent portable NSIS patch removes tab-indented exit cleanup", () => {
  const context = loadMainContext();
  const template = [
    ' StrCpy $INSTDIR "$PLUGINSDIR\\app"',
    " !ifdef UNPACK_DIR_NAME",
    ' StrCpy $INSTDIR "$TEMP\\${UNPACK_DIR_NAME}"',
    " !endif",
    " RMDir /r $INSTDIR",
    " SetOutPath $INSTDIR",
    ' ExecWait "$INSTDIR\\${APP_EXECUTABLE_FILENAME} $R0" $0',
    " SetErrorLevel $0",
    " SetOutPath $EXEDIR",
    "\tRMDir /r $INSTDIR",
    "SectionEnd",
  ].join("\n");

  const patched = context.createPersistentPortableNsiScript(template);
  const exitSection = patched.slice(patched.indexOf(" SetOutPath $EXEDIR"));

  assert.match(patched, / RMDir \/r \$INSTDIR/);
  assert.doesNotMatch(exitSection, /[ \t]+RMDir \/r \$INSTDIR/);
});

test("persistent portable NSIS patch tolerates CRLF and blank lines", () => {
  const context = loadMainContext();
  const template = [
    ' StrCpy $INSTDIR "$PLUGINSDIR\\app"',
    "",
    " !ifdef UNPACK_DIR_NAME",
    "",
    ' StrCpy $INSTDIR "$TEMP\\${UNPACK_DIR_NAME}"',
    "",
    " !endif",
    " SetOutPath $EXEDIR",
    " RMDir /r $INSTDIR",
    "SectionEnd",
  ].join("\r\n");

  const patched = context.createPersistentPortableNsiScript(template);

  assert.match(patched, /\$EXEDIR\\\$\{UNPACK_DIR_NAME\}/);
  assert.doesNotMatch(patched, /\$TEMP\\\$\{UNPACK_DIR_NAME\}/);
  assert.equal((patched.match(/RMDir \/r \$INSTDIR/g) || []).length, 0);
});
