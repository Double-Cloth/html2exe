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
    this.children = [];
    this.label = "";
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
    if (!this._innerHTML) {
      this.children = [];
    }
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

  appendChild(child) {
    this.children.push(child);
    return child;
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
    createElement(tagName) {
      const element = new FakeElement();
      element.tagName = String(tagName || "").toUpperCase();
      return element;
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
            getVersion: () => "2.0.5",
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
  textField("electronVersion", "44.3.0");
  textField("chromiumVersion", "152.0.7977.78");
  textField("nodeVersion", "24.21.0");
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
  assert.equal(savedPayload.electronVersion, "44.3.0");
  assert.equal(savedPayload.chromiumVersion, "152.0.7977.78");
  assert.equal(savedPayload.nodeVersion, "24.21.0");
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

test("官方运行时版本数据会转换为最新候选并过滤预发布版本", () => {
  const context = loadMainContext();
  const options = context.createRuntimeVersionOptions(
    [
      { version: "45.0.0-alpha.1", chrome: "155.0.1.2", node: "24.21.0" },
      { version: "44.3.0", chrome: "152.0.7977.78", node: "24.20.0" },
      { version: "44.2.0", chrome: "152.0.7977.60", node: "24.20.0" },
      { version: "43.6.0", chrome: "150.0.7871.250", node: "24.20.0" },
      { version: "42.11.3", chrome: "148.0.7778.280", node: "24.19.0" },
    ],
    [
      { version: "v26.8.1", lts: false },
      { version: "v26.8.0", lts: false },
      { version: "v24.21.0", lts: "Krypton" },
      { version: "v22.23.2", lts: "Jod" },
    ]
  );

  assert.deepEqual(
    Array.from(options.electron, (option) => option.value),
    ["44.3.0", "43.6.0", "42.11.3"]
  );
  assert.deepEqual(
    Array.from(options.chromium, (option) => option.value),
    ["152.0.7977.78", "150.0.7871.250", "148.0.7778.280"]
  );
  assert.deepEqual(
    Array.from(options.node, (option) => option.value),
    ["26.8.1", "24.21.0", "22.23.2", "24.20.0", "24.19.0"]
  );
});

test("渲染层自动更新版本候选时不会改写版本输入框", () => {
  const context = loadRendererContext();
  const electronInput = new FakeElement("electronVersion");
  electronInput.value = "43.6.0";
  context.__elements.set("electronVersion", electronInput);

  ["electronVersionOptions", "chromiumVersionOptions", "nodeVersionOptions"].forEach((id) => {
    context.__elements.set(id, new FakeElement(id));
  });

  const updated = context.applyRuntimeVersionOptions({
    electron: [{ value: "44.4.0", label: "最新稳定版" }],
    chromium: [{ value: "152.0.8000.1", label: "Electron 44.4.0 内置" }],
    node: [{ value: "26.9.0", label: "最新 Current" }],
    source: "remote",
    updatedAt: "2026-09-09T00:00:00.000Z",
  });

  assert.equal(updated, true);
  assert.equal(electronInput.value, "43.6.0");
  assert.equal(context.__elements.get("electronVersionOptions").children[0].value, "44.4.0");
  assert.equal(context.__elements.get("chromiumVersionOptions").children[0].value, "152.0.8000.1");
  assert.equal(context.__elements.get("nodeVersionOptions").children[0].value, "26.9.0");
});

test("默认 Windows 图标直接使用有效 ICO 文件", () => {
  const context = loadMainContext();
  const defaults = context.getDefaultFormSettings();

  assert.ok(defaults.winIcon.toLowerCase().endsWith(".ico"));
  assert.doesNotThrow(() => context.validateWindowsIcoBuffer(fs.readFileSync(defaults.winIcon)));
});

test("PNG 转换后的 Windows ICO 包含完整的多尺寸目录", () => {
  const context = loadMainContext();
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const frames = sizes.map((size) => {
    const png = Buffer.alloc(24);
    pngSignature.copy(png, 0);
    png.writeUInt32BE(size, 16);
    png.writeUInt32BE(size, 20);
    return { size, png };
  });

  const ico = context.createWindowsIcoBuffer(frames);

  assert.equal(context.validateWindowsIcoBuffer(ico), sizes.length);
  assert.equal(ico.readUInt16LE(4), sizes.length);
  sizes.forEach((size, index) => {
    const entryOffset = 6 + index * 16;
    assert.equal(ico[entryOffset], size === 256 ? 0 : size);
    assert.equal(ico[entryOffset + 1], size === 256 ? 0 : size);
  });
});

test("Windows 图标路径失效时停止构建而不是静默使用默认图标", async () => {
  const context = loadMainContext();
  const missingIcon = path.join(repoRoot, ".test-cache", "missing-icon.ico");

  await assert.rejects(
    context.materializeIconPathForBuilder(missingIcon, "win", repoRoot),
    /Windows 图标路径不存在.*停止构建/
  );
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

  context.resetFormToDefaults({ electronVersion: "44.3.0" });

  assert.equal(productName.value, "");
  assert.equal(compression.value, "normal");
  assert.equal(electronVersion.value, "44.3.0");
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

test("纯 HTML Windows 构建会把页面公司名和版本写入解压后的主程序", async () => {
  const context = loadMainContext();
  const hookModule = { exports: {} };
  let invocation = null;
  const fakeFs = {
    existsSync: () => true,
  };

  vm.runInNewContext(context.createHtmlOnlyAfterPackHookContent(), {
    console: { log: () => {} },
    module: hookModule,
    process: {
      env: {
        HTML2EXE_RCEDIT_PATH: "C:\\tools\\rcedit.exe",
      },
    },
    require(request) {
      if (request === "node:fs") {
        return fakeFs;
      }
      if (request === "node:path") {
        return path;
      }
      if (request === "node:child_process") {
        return {
          spawnSync(command, args, options) {
            invocation = { command, args, options };
            return { status: 0 };
          },
        };
      }
      throw new Error(`unexpected require: ${request}`);
    },
  });

  await hookModule.exports({
    electronPlatformName: "win32",
    appOutDir: "C:\\release\\win-unpacked",
    packager: {
      appInfo: {
        productFilename: "Demo",
        productName: "示例应用",
        name: "demo",
        companyName: "示例公司",
        copyright: "Copyright © 2026 示例公司",
        version: "1.2.3",
        buildVersion: "1.2.3",
        getVersionInWeirdWindowsForm: () => "1.2.3.0",
      },
    },
  });

  assert.ok(invocation);
  assert.equal(invocation.command, "C:\\tools\\rcedit.exe");
  assert.deepEqual(Array.from(invocation.args.slice(1, 5)), [
    "--set-file-version",
    "1.2.3.0",
    "--set-product-version",
    "1.2.3.0",
  ]);

  const versionStrings = new Map();
  for (let index = 5; index < invocation.args.length; index += 3) {
    assert.equal(invocation.args[index], "--set-version-string");
    versionStrings.set(invocation.args[index + 1], invocation.args[index + 2]);
  }
  assert.equal(versionStrings.get("CompanyName"), "示例公司");
  assert.equal(versionStrings.get("ProductName"), "示例应用");
  assert.equal(versionStrings.get("FileVersion"), "1.2.3");
  assert.equal(versionStrings.get("ProductVersion"), "1.2.3");
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
  assert.match(patched, /SHChangeNotify\(i 0x08000000/);
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
