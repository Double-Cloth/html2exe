const originalEmitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, ...args) => {
  const optionLike = args.find((item) => item && typeof item === "object");
  const codeFromOptions = optionLike && typeof optionLike.code === "string" ? optionLike.code : "";
  const codeFromArgs =
    typeof args[1] === "string" ? args[1] : typeof args[0] === "string" && args[0].startsWith("DEP") ? args[0] : "";
  const code = codeFromOptions || codeFromArgs || (warning && typeof warning === "object" ? warning.code : "");

  if (code === "DEP0180") {
    return;
  }

  return originalEmitWarning(warning, ...args);
};

const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const fs = require("node:fs/promises");
const fssync = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn, spawnSync } = require("node:child_process");

const SETTINGS_FILE_NAME = "builder-settings.json";
const ELECTRON_BUILDER_VERSION = "26.8.1";
const ELECTRON_BUILDER_BINARIES_MIRROR_DEFAULT = "https://npmmirror.com/mirrors/electron-builder-binaries/";
const LOCAL_CACHE_ROOT = app.isPackaged
  ? path.join(app.getPath("appData"), app.getName() || "html2exe", ".cache")
  : path.join(__dirname, ".cache");
const DEFAULT_PROJECT_ICON_CANDIDATES = [
  path.join(__dirname, "src", "assets", "images", "icon.png"),
  path.join(__dirname, "assets", "images", "icon.png"),
];
let cachedDefaultProjectIconPath = null;
const CACHE_PATHS = {
  appUserData: path.join(LOCAL_CACHE_ROOT, "electron", "user-data"),
  appCache: path.join(LOCAL_CACHE_ROOT, "electron", "cache"),
  appTemp: path.join(LOCAL_CACHE_ROOT, "electron", "temp"),
  appLogs: path.join(LOCAL_CACHE_ROOT, "electron", "logs"),
  builderTemp: path.join(LOCAL_CACHE_ROOT, "builder", "temp"),
  builderCache: path.join(LOCAL_CACHE_ROOT, "builder", "cache"),
  electronDownloadCache: path.join(LOCAL_CACHE_ROOT, "builder", "electron-download"),
  npmCache: path.join(LOCAL_CACHE_ROOT, "builder", "npm-cache"),
  toolchainRoot: path.join(LOCAL_CACHE_ROOT, "builder", "toolchain"),
};

let cachedBuilderBootstrapPromise = null;

function normalizeMirrorBaseUrl(value) {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

function ensureLocalCacheDirs() {
  Object.values(CACHE_PATHS).forEach((dir) => {
    fssync.mkdirSync(dir, { recursive: true });
  });
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch (error) {
    return false;
  }
}

function resolveDefaultProjectIconPath() {
  if (cachedDefaultProjectIconPath !== null) {
    return cachedDefaultProjectIconPath;
  }

  const candidates = [...DEFAULT_PROJECT_ICON_CANDIDATES];

  try {
    const appPath = app.getAppPath();
    if (appPath) {
      candidates.push(path.join(appPath, "src", "assets", "images", "icon.png"));
      candidates.push(path.join(appPath, "assets", "images", "icon.png"));
    }
  } catch (error) {}

  try {
    const resourcesPath = process.resourcesPath || "";
    if (resourcesPath) {
      candidates.push(path.join(resourcesPath, "app.asar.unpacked", "src", "assets", "images", "icon.png"));
      candidates.push(path.join(resourcesPath, "app", "src", "assets", "images", "icon.png"));
      candidates.push(path.join(resourcesPath, "src", "assets", "images", "icon.png"));
    }
  } catch (error) {}

  cachedDefaultProjectIconPath = candidates.find((candidate) => fssync.existsSync(candidate)) || "";
  return cachedDefaultProjectIconPath;
}

function runCommandCapture(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      ...options,
      stdio: "pipe",
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      resolve({
        code: -1,
        stdout,
        stderr: `${stderr}\n${error.message}`.trim(),
      });
    });

    child.on("close", (code) => {
      resolve({ code: Number(code), stdout, stderr });
    });
  });
}

function collectBundledNodeModuleRoots() {
  const roots = new Set();

  const resourcePath = process.resourcesPath || "";
  if (resourcePath) {
    roots.add(path.join(resourcePath, "embedded", "toolchain", "node_modules"));
    roots.add(path.join(resourcePath, "embedded", "node_modules"));
    roots.add(path.join(resourcePath, "app", "embedded", "toolchain", "node_modules"));
    roots.add(path.join(resourcePath, "app", "embedded", "node_modules"));
    roots.add(path.join(resourcePath, "app", "vendor", "toolchain", "node_modules"));
    roots.add(path.join(resourcePath, "app.asar.unpacked", "embedded", "toolchain", "node_modules"));
    roots.add(path.join(resourcePath, "app.asar.unpacked", "embedded", "node_modules"));
    roots.add(path.join(resourcePath, "app.asar.unpacked", "vendor", "toolchain", "node_modules"));
  }

  const appPath = app.getAppPath();
  const appDir = path.dirname(appPath);
  roots.add(path.join(appPath, "embedded", "toolchain", "node_modules"));
  roots.add(path.join(appPath, "embedded", "node_modules"));
  roots.add(path.join(appPath, "vendor", "toolchain", "node_modules"));
  roots.add(path.join(appPath, "node_modules"));
  roots.add(path.join(appDir, "embedded", "toolchain", "node_modules"));
  roots.add(path.join(appDir, "embedded", "node_modules"));
  roots.add(path.join(appDir, "app", "embedded", "toolchain", "node_modules"));
  roots.add(path.join(appDir, "app", "embedded", "node_modules"));
  roots.add(path.join(appDir, "app", "vendor", "toolchain", "node_modules"));
  roots.add(path.join(appDir, "app.asar.unpacked", "vendor", "toolchain", "node_modules"));

  const exeDir = path.dirname(process.execPath || "");
  if (exeDir) {
    roots.add(path.join(exeDir, "resources", "embedded", "toolchain", "node_modules"));
    roots.add(path.join(exeDir, "resources", "embedded", "node_modules"));
    roots.add(path.join(exeDir, "resources", "app", "embedded", "toolchain", "node_modules"));
    roots.add(path.join(exeDir, "resources", "app", "embedded", "node_modules"));
    roots.add(path.join(exeDir, "resources", "app", "vendor", "toolchain", "node_modules"));
    roots.add(path.join(exeDir, "resources", "app.asar.unpacked", "embedded", "toolchain", "node_modules"));
    roots.add(path.join(exeDir, "resources", "app.asar.unpacked", "embedded", "node_modules"));
    roots.add(path.join(exeDir, "resources", "app.asar.unpacked", "vendor", "toolchain", "node_modules"));
  }

  roots.add(path.join(__dirname, "vendor", "toolchain", "node_modules"));
  roots.add(path.join(__dirname, "node_modules"));

  if (resourcePath && fssync.existsSync(resourcePath)) {
    try {
      const walk = (d, depth) => {
        if (depth > 3) return;
        const entries = fssync.readdirSync(d, { withFileTypes: true });
        for (const e of entries) {
          if (e.isDirectory() && e.name !== "app.asar") {
             if (e.name === "node_modules") roots.add(path.join(d, e.name));
             else walk(path.join(d, e.name), depth + 1);
          }
        }
      };
      walk(resourcePath, 0);
    } catch(e) {}
  }

  if (exeDir) {
    const fallbackRes = path.join(exeDir, "resources");
    if (fallbackRes !== resourcePath && fssync.existsSync(fallbackRes)) {
      try {
        const walk = (d, depth) => {
          if (depth > 3) return;
          const entries = fssync.readdirSync(d, { withFileTypes: true });
          for (const e of entries) {
            if (e.isDirectory() && e.name !== "app.asar") {
               if (e.name === "node_modules") roots.add(path.join(d, e.name));
               else walk(path.join(d, e.name), depth + 1);
            }
          }
        };
        walk(fallbackRes, 0);
      } catch(e) {}
    }
  }

  return [...roots].filter(Boolean);
}

function resolveBundledBuilderCliPath() {
  const candidates = [];
  collectBundledNodeModuleRoots().forEach((root) => {
    if (!root) {
      return;
    }
    const packageJsonPath = path.join(root, "electron-builder", "package.json");
    if (fssync.existsSync(packageJsonPath)) {
      try {
        const pkg = JSON.parse(fssync.readFileSync(packageJsonPath, "utf-8"));
        if (pkg && pkg.bin) {
          if (typeof pkg.bin === "string") {
            candidates.push(path.join(root, "electron-builder", pkg.bin));
          } else if (typeof pkg.bin === "object") {
            const binValue = pkg.bin["electron-builder"] || pkg.bin["electron-builder.js"] || Object.values(pkg.bin)[0];
            if (typeof binValue === "string") {
              candidates.push(path.join(root, "electron-builder", binValue));
            }
          }
        }
      } catch (error) {}
    }
    candidates.push(path.join(root, "electron-builder", "cli.js"));
    candidates.push(path.join(root, "electron-builder", "out", "cli", "cli.js"));
    candidates.push(path.join(root, "electron-builder", "out", "cli.js"));
  });

  for (const candidate of candidates) {
    if (fssync.existsSync(candidate)) {
      return candidate;
    }
  }

  return "";
}

function resolveBundledNpmCliPath() {
  const candidates = [];
  collectBundledNodeModuleRoots().forEach((root) => {
    if (!root) {
      return;
    }
    const packageJsonPath = path.join(root, "npm", "package.json");
    if (fssync.existsSync(packageJsonPath)) {
      try {
        const pkg = JSON.parse(fssync.readFileSync(packageJsonPath, "utf-8"));
        if (pkg && pkg.bin) {
          if (typeof pkg.bin === "string") {
            candidates.push(path.join(root, "npm", pkg.bin));
          } else if (typeof pkg.bin === "object") {
            const binValue = pkg.bin.npm || pkg.bin["npm-cli"] || pkg.bin["npm-cli.js"] || Object.values(pkg.bin)[0];
            if (typeof binValue === "string") {
              candidates.push(path.join(root, "npm", binValue));
            }
          }
        }
      } catch (error) {}
    }
    candidates.push(path.join(root, "npm", "bin", "npm-cli.js"));
    candidates.push(path.join(root, "npm", "lib", "cli.js"));
    candidates.push(path.join(root, "npm", "dist", "bin", "npm-cli.js"));
  });

  for (const candidate of candidates) {
    if (fssync.existsSync(candidate)) {
      return candidate;
    }
  }

  return "";
}

function resolveBuilderPackageRootFromCli(cliPath) {
  let current = path.dirname(cliPath);
  for (let depth = 0; depth < 6; depth += 1) {
    const pkgPath = path.join(current, "package.json");
    if (fssync.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fssync.readFileSync(pkgPath, "utf-8"));
        if (pkg && pkg.name === "electron-builder") {
          return current;
        }
      } catch (error) {
        // Ignore parse failure and continue climbing.
      }
    }

    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return "";
}

async function restoreCachedBuilderFromBundled(onLog = noop) {
  const bundledCli = resolveBundledBuilderCliPath();
  if (!bundledCli) {
    return "";
  }

  const bundledPackageRoot = resolveBuilderPackageRootFromCli(bundledCli);
  if (!bundledPackageRoot) {
    return "";
  }
  const cacheDir = path.join(CACHE_PATHS.toolchainRoot, `electron-builder-${ELECTRON_BUILDER_VERSION}`);

  await rmWithRetry(cacheDir, { recursive: true, force: true }).catch(noop);
  await fs.mkdir(path.dirname(cacheDir), { recursive: true });
  await fs.cp(bundledPackageRoot, cacheDir, { recursive: true, force: true });

  const cacheCli = path.join(cacheDir, "cli.js");
  if (await pathExists(cacheCli)) {
    onLog(`已从内置工具链恢复缓存: ${cacheDir}\n`);
    return cacheCli;
  }

  const cacheCliFallback = path.join(cacheDir, "out", "cli", "cli.js");
  if (await pathExists(cacheCliFallback)) {
    onLog(`已从内置工具链恢复缓存: ${cacheDir}\n`);
    return cacheCliFallback;
  }

  return "";
}

function isCachedBuilderComplete(cacheDir) {
  try {
    require.resolve("electron-builder/cli.js", { paths: [cacheDir] });
    require.resolve("app-builder-lib/out/electron/electronVersion", {
      paths: [cacheDir],
    });
    return true;
  } catch (error) {
    return false;
  }
}

async function bootstrapCachedBuilderCli(onLog = noop) {
  if (cachedBuilderBootstrapPromise) {
    return cachedBuilderBootstrapPromise;
  }

  cachedBuilderBootstrapPromise = (async () => {
    const cacheDir = path.join(CACHE_PATHS.toolchainRoot, `electron-builder-${ELECTRON_BUILDER_VERSION}`);
    const cliCandidates = [
      path.join(cacheDir, "node_modules", "electron-builder", "cli.js"),
      path.join(cacheDir, "node_modules", "electron-builder", "out", "cli", "cli.js"),
    ];

    if (isCachedBuilderComplete(cacheDir)) {
      for (const candidate of cliCandidates) {
        if (await pathExists(candidate)) {
          return candidate;
        }
      }
    }

    const restoredCli = await restoreCachedBuilderFromBundled(onLog);
    if (restoredCli) {
      return restoredCli;
    }

    const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
    const systemNpmAvailable = hasExecutable(npmCommand);
    const bundledNpmCli = systemNpmAvailable ? "" : resolveBundledNpmCliPath();
    if (!systemNpmAvailable && !bundledNpmCli) {
        const checkedRoots = collectBundledNodeModuleRoots();
        throw new Error(`当前环境未检测到 npm，且未找到内置 npm-cli，无法自动安装缓存工具链。\n(内置 npm 检索路径: ${checkedRoots.join(" | ")})`);
    }
    await rmWithRetry(cacheDir, { recursive: true, force: true }).catch(noop);
    await fs.mkdir(cacheDir, { recursive: true });

    const toolchainPkg = {
      name: "html2exe-toolchain-cache",
      private: true,
      version: "1.0.0",
      description: "cached build toolchain for html2exe",
      dependencies: {
        "electron-builder": ELECTRON_BUILDER_VERSION,
      },
    };
    await fs.writeFile(
      path.join(cacheDir, "package.json"),
      JSON.stringify(toolchainPkg, null, 2),
      "utf-8"
    );

    onLog(`本地工具链缺失，正在下载并安装 electron-builder@${ELECTRON_BUILDER_VERSION} 到缓存目录...\n`);
    let installResult;
    if (systemNpmAvailable) {
      installResult = await runCommandCapture(
        npmCommand,
        ["install", "--no-audit", "--no-fund", "--include=optional"],
        {
          cwd: cacheDir,
          windowsHide: true,
          env: {
            ...process.env,
            npm_config_cache: CACHE_PATHS.npmCache,
            NPM_CONFIG_CACHE: CACHE_PATHS.npmCache,
          },
        }
      );
    } else {
      onLog(`系统 npm 不可用，改用内置 npm-cli: ${bundledNpmCli}\n`);
      installResult = await runCommandCapture(
        process.execPath,
        [bundledNpmCli, "install", "--no-audit", "--no-fund", "--include=optional"],
        {
          cwd: cacheDir,
          windowsHide: true,
          env: {
            ...process.env,
            ELECTRON_RUN_AS_NODE: "1",
            npm_config_cache: CACHE_PATHS.npmCache,
            NPM_CONFIG_CACHE: CACHE_PATHS.npmCache,
          },
        }
      );
    }

    if (installResult.code !== 0) {
      const detail = (installResult.stderr || installResult.stdout || "").trim();
      throw new Error(`缓存工具链安装失败: ${detail || `npm 退出码 ${installResult.code}`}`);
    }

    for (const candidate of cliCandidates) {
      if (await pathExists(candidate)) {
        onLog(`已完成工具链缓存: ${cacheDir}\n`);
        return candidate;
      }
    }

    throw new Error("工具链安装完成，但未找到可用 CLI 入口。");
  })();

  try {
    const resolved = await cachedBuilderBootstrapPromise;
    return resolved;
  } catch (error) {
    cachedBuilderBootstrapPromise = null;
    throw error;
  }
}

function configureLocalAppPaths() {
  ensureLocalCacheDirs();
  app.setPath("userData", CACHE_PATHS.appUserData);
  app.setPath("cache", CACHE_PATHS.appCache);
  app.setPath("temp", CACHE_PATHS.appTemp);
  app.setPath("logs", CACHE_PATHS.appLogs);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function rmWithRetry(targetPath, options = {}, retries = 8) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      await fs.rm(targetPath, options);
      return;
    } catch (error) {
      const code = error && error.code;
      const shouldRetry =
        attempt < retries && (code === "EBUSY" || code === "ENOTEMPTY" || code === "EPERM");
      if (!shouldRetry) {
        throw error;
      }
      await sleep(180 * (attempt + 1));
    }
  }
}

function isLockRelatedError(error) {
  const code = error && error.code;
  return code === "EBUSY" || code === "EPERM" || code === "ENOTEMPTY";
}

function toPosixPath(inputPath) {
  return String(inputPath || "").replace(/\\/g, "/");
}

function collectUnlockCandidates(targetPath, errorMessage = "") {
  const candidates = new Set();
  const normalizedTarget = path.resolve(targetPath);
  candidates.add(normalizedTarget);
  candidates.add(path.dirname(normalizedTarget));

  const message = String(errorMessage || "");
  const pathMatch = message.match(/'([^']+)'/);
  if (pathMatch && pathMatch[1]) {
    const lockedPath = path.resolve(pathMatch[1]);
    candidates.add(lockedPath);
    candidates.add(path.dirname(lockedPath));

    const marker = `${path.sep}win-unpacked${path.sep}`;
    const markerIndex = lockedPath.toLowerCase().indexOf(marker.toLowerCase());
    if (markerIndex >= 0) {
      candidates.add(lockedPath.slice(0, markerIndex + marker.length - 1));
    }
  }

  return Array.from(candidates)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => toPosixPath(item).toLowerCase());
}

async function runPowerShellJson(script, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const ps = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      {
        windowsHide: true,
      }
    );

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      ps.kill();
      reject(new Error("PowerShell unlock command timeout"));
    }, timeoutMs);

    ps.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    ps.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    ps.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    ps.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stderr.trim() || `PowerShell exited with code ${code}`));
        return;
      }

      const trimmed = stdout.trim();
      if (!trimmed) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(trimmed));
      } catch (error) {
        reject(new Error(`Invalid PowerShell JSON output: ${trimmed}`));
      }
    });
  });
}

async function tryReleaseWindowsLocks(candidatePaths) {
  if (process.platform !== "win32") {
    return { attempted: false, killed: 0, processes: [] };
  }

  const targets = Array.from(new Set((candidatePaths || []).map((item) => String(item || "").trim().toLowerCase()).filter(Boolean)));
  if (targets.length === 0) {
    return { attempted: false, killed: 0, processes: [] };
  }

  const targetsLiteral = JSON.stringify(targets);
  const script = `$ErrorActionPreference = 'SilentlyContinue'\n$targets = ${targetsLiteral} | ForEach-Object { $_.ToString().ToLowerInvariant() }\n$rows = New-Object System.Collections.Generic.List[object]\nGet-CimInstance Win32_Process | ForEach-Object {\n  $pid = $_.ProcessId\n  if ($pid -eq $PID) { return }\n  $exe = if ($_.ExecutablePath) { $_.ExecutablePath.ToLowerInvariant().Replace('\\','/') } else { '' }\n  $cmd = if ($_.CommandLine) { $_.CommandLine.ToLowerInvariant().Replace('\\','/') } else { '' }\n  $matched = $false\n  foreach ($t in $targets) {\n    if (($exe -and $exe.StartsWith($t)) -or ($cmd -and $cmd.Contains($t))) {\n      $matched = $true\n      break\n    }\n  }\n  if ($matched) {\n    try {\n      Stop-Process -Id $pid -Force -ErrorAction Stop\n      $rows.Add([PSCustomObject]@{ pid = $pid; name = $_.Name }) | Out-Null\n    } catch {}\n  }\n}\n[PSCustomObject]@{ attempted = $true; killed = $rows.Count; processes = $rows } | ConvertTo-Json -Compress`;

  try {
    const result = await runPowerShellJson(script, 10000);
    const processes = Array.isArray(result.processes) ? result.processes : [];
    return {
      attempted: true,
      killed: Number(result.killed || 0),
      processes,
    };
  } catch (error) {
    return {
      attempted: true,
      killed: 0,
      processes: [],
      error: error.message,
    };
  }
}

async function tryUnlockAndRemove(targetPath, options = {}, errorForCandidates = null) {
  const candidates = collectUnlockCandidates(
    targetPath,
    errorForCandidates && errorForCandidates.message
  );
  const release = await tryReleaseWindowsLocks(candidates);

  if (release.killed > 0) {
    await sleep(300);
  }

  try {
    await rmWithRetry(targetPath, options, 5);
    return {
      removed: true,
      release,
    };
  } catch (error) {
    return {
      removed: false,
      release,
      error,
    };
  }
}

async function cleanupLegacyTempArtifacts() {
  const tempRoot = os.tmpdir();
  let names = [];
  try {
    names = await fs.readdir(tempRoot);
  } catch (error) {
    return;
  }

  const targets = names.filter(
    (name) =>
      name.startsWith("electron-html-pack-") ||
      name.startsWith("electron-builder-ui-")
  );

  const skipped = [];
  let autoRecovered = 0;
  let killedProcesses = 0;
  const unlockedBy = [];
  await Promise.all(
    targets.map(async (name) => {
      const fullPath = path.join(tempRoot, name);
      try {
        await rmWithRetry(fullPath, { recursive: true, force: true });
      } catch (error) {
        if (isLockRelatedError(error)) {
          const unlockResult = await tryUnlockAndRemove(
            fullPath,
            { recursive: true, force: true },
            error
          );
          killedProcesses += unlockResult.release.killed || 0;
          if (Array.isArray(unlockResult.release.processes)) {
            unlockedBy.push(...unlockResult.release.processes);
          }

          if (unlockResult.removed) {
            autoRecovered += 1;
            return;
          }

          const finalError = unlockResult.error || error;
          skipped.push({
            path: fullPath,
            code: finalError.code || "EBUSY",
            message: finalError.message,
          });
          return;
        }
        throw error;
      }
    })
  );

  return {
    skipped,
    autoRecovered,
    killedProcesses,
    unlockedBy,
  };
}

async function clearLocalCaches() {
  const targets = [
    CACHE_PATHS.appCache,
    CACHE_PATHS.appTemp,
    CACHE_PATHS.appLogs,
    CACHE_PATHS.builderTemp,
    CACHE_PATHS.builderCache,
    CACHE_PATHS.electronDownloadCache,
    CACHE_PATHS.npmCache,
  ];

  let removed = 0;
  const skipped = [];
  let autoRecovered = 0;
  let killedProcesses = 0;
  const unlockedBy = [];
  for (const target of targets) {
    try {
      await rmWithRetry(target, { recursive: true, force: true });
      removed += 1;
    } catch (error) {
      if (isLockRelatedError(error)) {
        const unlockResult = await tryUnlockAndRemove(
          target,
          { recursive: true, force: true },
          error
        );
        killedProcesses += unlockResult.release.killed || 0;
        if (Array.isArray(unlockResult.release.processes)) {
          unlockedBy.push(...unlockResult.release.processes);
        }

        if (unlockResult.removed) {
          removed += 1;
          autoRecovered += 1;
          continue;
        }

        const finalError = unlockResult.error || error;
        skipped.push({
          path: target,
          code: finalError.code || "EBUSY",
          message: finalError.message,
        });
        continue;
      }
      throw error;
    }
  }

  ensureLocalCacheDirs();
  const legacyResult = await cleanupLegacyTempArtifacts();
  autoRecovered += legacyResult.autoRecovered || 0;
  killedProcesses += legacyResult.killedProcesses || 0;
  if (Array.isArray(legacyResult.unlockedBy)) {
    unlockedBy.push(...legacyResult.unlockedBy);
  }

  const uniqueUnlockedBy = Array.from(
    new Map(
      unlockedBy.map((item) => [
        `${item.name || "process"}#${item.pid || "0"}`,
        item,
      ])
    ).values()
  );

  return {
    cacheRoot: LOCAL_CACHE_ROOT,
    removed,
    skipped: [...skipped, ...(legacyResult.skipped || [])],
    autoRecovered,
    killedProcesses,
    unlockedBy: uniqueUnlockedBy,
  };
}

configureLocalAppPaths();

let mainWindow;
let activeBuild = null;

const STEP_KEYS = {
  PREPARE: "prepare",
  TEMP_PROJECT: "temp-project",
  INSTALL: "install",
  PACKAGE: "package",
  ARTIFACT: "artifact",
  COMPLETE: "complete",
};

function noop() {}

function updateStep(onStatus, step, state, text) {
  onStatus({ type: "step", step, state, text: text || "" });
}

function updateOverall(onStatus, state, text) {
  onStatus({ type: "overall", state, text: text || "" });
}

function handleBuilderChunk(line, stepMarks, onStatus) {
  const lower = String(line || "").toLowerCase();

  if (lower.includes("installing dependencies") && !stepMarks.installStarted) {
    stepMarks.installStarted = true;
    updateStep(onStatus, STEP_KEYS.INSTALL, "running", "安装依赖中");
  }
  if (
    (lower.includes("completed installing native dependencies") ||
      lower.includes("installing native dependencies")) &&
    !stepMarks.installCompleted
  ) {
    stepMarks.installCompleted = true;
    updateStep(onStatus, STEP_KEYS.INSTALL, "done", "依赖安装完成");
  }

  if (lower.includes("packaging") && !stepMarks.packageStarted) {
    stepMarks.packageStarted = true;
    updateStep(onStatus, STEP_KEYS.PACKAGE, "running", "应用封装中");
  }

  if (
    (lower.includes("building") || lower.includes("artifact") || lower.includes("nsis")) &&
    !stepMarks.artifactStarted
  ) {
    stepMarks.artifactStarted = true;
    updateStep(onStatus, STEP_KEYS.ARTIFACT, "running", "生成安装包中");
  }
}

function sanitizeName(name) {
  return String(name || "html-app")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "html-app";
}

async function findFirstHtmlFile(rootDir) {
  const queue = [""];
  while (queue.length > 0) {
    const relativeDir = queue.shift();
    const absDir = path.join(rootDir, relativeDir);
    const entries = await fs.readdir(absDir, { withFileTypes: true });

    const indexFile = entries.find(
      (entry) => entry.isFile() && entry.name.toLowerCase() === "index.html"
    );
    if (indexFile) {
      return path.join(relativeDir, indexFile.name);
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (["node_modules", ".git", "release", "dist"].includes(entry.name)) {
          continue;
        }
        queue.push(path.join(relativeDir, entry.name));
      }
    }

    const anyHtml = entries.find(
      (entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".html")
    );
    if (anyHtml) {
      return path.join(relativeDir, anyHtml.name);
    }
  }

  return "";
}

function getSettingsPath() {
  return path.join(app.getPath("userData"), SETTINGS_FILE_NAME);
}

function getDefaultFormSettings() {
  const localElectronVersion = resolveLocalElectronVersion();
  return {
    winIcon: resolveDefaultProjectIconPath(),
    linuxIcon: resolveDefaultProjectIconPath(),
    macIcon: resolveDefaultProjectIconPath(),
    electronVersion: localElectronVersion,
    chromiumVersion: "",
    nodeVersion: "",
  };
}

async function readSettings() {
  const settingsPath = getSettingsPath();
  try {
    const content = await fs.readFile(settingsPath, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    return {};
  }
}

async function writeSettings(settings) {
  const settingsPath = getSettingsPath();
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), "utf-8");
}

function createWindow() {
  const defaultIcon = resolveDefaultProjectIconPath();
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 1080,
    minHeight: 680,
    autoHideMenuBar: true,
    icon: defaultIcon || undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "src", "index.html"));
}

function parseCommaList(raw) {
  if (!raw || !raw.trim()) {
    return [];
  }
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseLines(raw) {
  if (!raw || !raw.trim()) {
    return [];
  }
  return raw
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function stringifyBuildArrayForForm(value) {
  if (!Array.isArray(value) || value.length === 0) {
    return "";
  }

  return value
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }
      if (item && typeof item === "object") {
        try {
          return JSON.stringify(item);
        } catch (error) {
          return String(item);
        }
      }
      return String(item);
    })
    .filter((line) => line && line.trim())
    .join("\n");
}

function parseLineItems(raw) {
  return parseLines(raw).map((line) => {
    const normalized = line.trim();
    if (!normalized) {
      return "";
    }

    if (normalized.startsWith("{") || normalized.startsWith("[")) {
      try {
        return JSON.parse(normalized);
      } catch (error) {
        return normalized;
      }
    }

    return normalized;
  }).filter(Boolean);
}

function parseArchFlags(raw) {
  const allowed = new Set(["x64", "arm64", "ia32", "armv7l", "universal"]);
  return parseCommaList(raw).filter((item) => allowed.has(item));
}

function uniqueLines(lines) {
  return Array.from(new Set(lines.filter(Boolean)));
}

function toPosixLowerPath(inputPath) {
  return toPosixPath(inputPath).toLowerCase();
}

function isPathInside(parentPath, childPath) {
  const relativePath = path.relative(parentPath, childPath);
  return Boolean(relativePath) && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

function shouldSkipHtmlCopyPath(sourceDir, outputDir, currentPath) {
  const normalizedCurrent = toPosixLowerPath(currentPath);
  const relativePath = path.relative(sourceDir, currentPath);

  if (!relativePath || relativePath === ".") {
    return false;
  }

  const normalizedSegments = relativePath
    .split(path.sep)
    .map((segment) => String(segment || "").toLowerCase())
    .filter(Boolean);

  if (normalizedSegments.includes("node_modules") || normalizedSegments.includes(".git")) {
    return true;
  }

  if (normalizedCurrent.includes("/win-unpacked/") || normalizedCurrent.endsWith("/win-unpacked")) {
    return true;
  }
  if (normalizedCurrent.includes("/app.asar.unpacked/") || normalizedCurrent.endsWith("/app.asar.unpacked")) {
    return true;
  }
  if (normalizedCurrent.includes("/release/") || normalizedCurrent.endsWith("/release")) {
    return true;
  }
  if (normalizedCurrent.includes("/dist/") || normalizedCurrent.endsWith("/dist")) {
    return true;
  }
  if (normalizedCurrent.includes("/out/") || normalizedCurrent.endsWith("/out")) {
    return true;
  }

  if (isPathInside(sourceDir, outputDir)) {
    const outputRelative = path.relative(sourceDir, outputDir);
    const outputSegments = outputRelative
      .split(path.sep)
      .map((segment) => String(segment || "").toLowerCase())
      .filter(Boolean);

    if (
      outputSegments.length > 0 &&
      outputSegments.every((segment, index) => normalizedSegments[index] === segment)
    ) {
      return true;
    }
  }

  return false;
}

function normalizeHtmlOnlyFilesGlobs(raw) {
  const required = [
    "main.js",
    "package.json",
    "app-source/**",
    "!release/**",
    "!dist/**",
    "!out/**",
    "!**/win-unpacked/**",
    "!**/app.asar.unpacked/**",
  ];
  const userLines = parseLines(raw).filter((line) => !line.startsWith("!"));

  if (userLines.length === 0) {
    return required.join("\n");
  }

  // Keep user positive rules but always include essential runtime files.
  return uniqueLines([...userLines, ...required]).join("\n");
}

function resolveLocalElectronVersion() {
  const electronPkgPath = path.join(
    __dirname,
    "node_modules",
    "electron",
    "package.json"
  );

  try {
    const content = fssync.readFileSync(electronPkgPath, "utf-8");
    const pkg = JSON.parse(content);
    if (pkg && typeof pkg.version === "string" && pkg.version.trim()) {
      return pkg.version.trim();
    }
  } catch (error) {
    // Ignore and fallback to fixed default.
  }

  return "41.2.0";
}

function normalizeVersionInput(raw) {
  const value = String(raw || "").trim();
  if (!value) {
    return "";
  }
  const match = value.match(/\d+\.\d+(?:\.\d+)?(?:[-.][0-9A-Za-z.]+)?/);
  return match ? match[0] : "";
}

function resolveElectronVersionFromManifest(pkg, build) {
  const fromBuild = normalizeVersionInput(build && build.electronVersion);
  if (fromBuild) {
    return fromBuild;
  }

  const fromDev = normalizeVersionInput(pkg && pkg.devDependencies && pkg.devDependencies.electron);
  if (fromDev) {
    return fromDev;
  }

  const fromDeps = normalizeVersionInput(pkg && pkg.dependencies && pkg.dependencies.electron);
  if (fromDeps) {
    return fromDeps;
  }

  return resolveLocalElectronVersion();
}

function parsePositiveInt(raw, fallback) {
  const value = Number.parseInt(String(raw || ""), 10);
  if (Number.isFinite(value) && value > 0) {
    return value;
  }
  return fallback;
}

function resolveBuilderRuntime() {
  const probe = spawnSync("node", ["--version"], {
    windowsHide: true,
    encoding: "utf-8",
  });

  if (probe.status === 0) {
    return {
      command: "node",
      mode: "node",
    };
  }

  // 检查 process.execPath 是否为 Electron 可执行文件（含 electron/html2exe 等）
  const execPathLower = String(process.execPath || "").toLowerCase();
  const isElectronExecutable = execPathLower.includes("electron") || 
                               execPathLower.includes("html2exe") ||
                               execPathLower.includes(".asar");
  
  // 如果是 Electron 可执行文件，尝试使用 npm exec 作为后备
  if (isElectronExecutable) {
    const npmProbe = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["--version"], {
      windowsHide: true,
      encoding: "utf-8",
    });
    
    if (npmProbe.status === 0) {
      return {
        command: process.platform === "win32" ? "npm.cmd" : "npm",
        mode: "npm-exec-fallback",
        useFallback: true,
      };
    }
  }

  return {
    command: process.execPath,
    mode: "electron-node",
  };
}

function hasExecutable(command, versionArgs = ["--version"]) {
  const probe = spawnSync(command, versionArgs, {
    windowsHide: true,
    encoding: "utf-8",
  });
  return probe.status === 0;
}

function resolveLocalBuilderCliPath() {
  const bundledCli = resolveBundledBuilderCliPath();
  if (bundledCli) {
    return bundledCli;
  }

  const candidates = ["electron-builder/cli.js", "electron-builder/out/cli/cli.js"];
  for (const request of candidates) {
    try {
      return require.resolve(request);
    } catch (error) {
      // Try next candidate.
    }
  }

  return "";
}

async function resolveBuilderLauncher(runtime, onLog = noop) {
  const localBuilderCli = resolveLocalBuilderCliPath();

  // Electron 打包态下，process.argv 可能包含重复的可执行路径，
  // 需要在 -e 内联脚本里归一化 argv，避免 electron-builder 把 cli.js 识别为业务参数。
  const getSafePrefixArgs = (cliPath) => {
    if (runtime.mode === "electron-node") {
      const cliLiteral = JSON.stringify(cliPath);
      const patchCode = [
        "process.defaultApp = true;",
        "process.noAsar = true;",
        "const argv = process.argv.slice();",
        "if (argv.length > 1 && argv[1] === process.execPath) argv.splice(1, 1);",
        `process.argv = [process.execPath, ${cliLiteral}, ...argv.slice(1)];`,
        `require(${cliLiteral});`,
      ].join(" ");
      return ["-e", patchCode];
    }
    return [cliPath];
  };

  if (localBuilderCli && !runtime.useFallback) {
    onLog(`检测到可用 electron-builder CLI: ${localBuilderCli}\n`);
    return {
      source: "local",
      command: runtime.command,
      prefixArgs: getSafePrefixArgs(localBuilderCli),
      mode: runtime.mode,
      description: "本地 electron-builder CLI（" + runtime.mode + "）",
    };
  }

  let cacheBootstrapError = "";
  if (!runtime.useFallback) {
    try {
      const cachedBuilderCli = await bootstrapCachedBuilderCli(onLog);
      if (cachedBuilderCli) {
        return {
          source: "cache",
          command: runtime.command,
          prefixArgs: getSafePrefixArgs(cachedBuilderCli),
          mode: runtime.mode,
          description: "缓存工具链 electron-builder CLI",
        };
      }
    } catch (error) {
      cacheBootstrapError = error && error.message ? error.message : String(error || "未知错误");
      onLog(`缓存工具链初始化失败，将尝试 npx/npm 兜底: ${cacheBootstrapError}\n`);
    }
  }

  const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
  if (hasExecutable(npxCommand)) {
    return {
      source: "npx",
      command: npxCommand,
      prefixArgs: ["--yes", `electron-builder@${ELECTRON_BUILDER_VERSION}`],
      mode: "npx",
      description: "npx electron-builder",
    };
  }

  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  if (hasExecutable(npmCommand)) {
    return {
      source: "npm-exec",
      command: npmCommand,
      prefixArgs: [
        "exec",
        "--yes",
        "--package",
        `electron-builder@${ELECTRON_BUILDER_VERSION}`,
        "--",
        "electron-builder",
      ],
      mode: "npm-exec",
      description: "npm exec electron-builder",
    };
  }

  const cacheHint = cacheBootstrapError
    ? ` 缓存工具链失败原因: ${cacheBootstrapError}`
    : "";
  throw new Error(
    `未找到可用的 electron-builder 入口（本地 CLI / 缓存工具链 / npx / npm exec）。请安装 Node.js（含 npm）或使用内置 electron-builder 重新打包本工具后再试。${cacheHint}`
  );
}

function getGeneratedWindowOptions(form) {
  const width = parsePositiveInt(form.windowWidth, 1280);
  const height = parsePositiveInt(form.windowHeight, 800);
  const showMenuBar = form.windowShowMenuBar !== false;

  return {
    title: form.windowTitle || form.productName || "HTML App",
    width,
    height,
    frame: form.windowFrame !== false,
    resizable: form.windowResizable !== false,
    fullscreenable: form.windowFullscreenable !== false,
    alwaysOnTop: Boolean(form.windowAlwaysOnTop),
    autoHideMenuBar: !showMenuBar,
    showMenuBar,
  };
}

function hasWindowUiOverride(form) {
  return (
    Boolean(form.windowTitle) ||
    Boolean(form.windowWidth) ||
    Boolean(form.windowHeight) ||
    form.windowShowMenuBar === false ||
    form.windowFrame === false ||
    form.windowResizable === false ||
    form.windowFullscreenable === false ||
    Boolean(form.windowAlwaysOnTop)
  );
}

async function readProjectManifest(projectDir) {
  const pkgPath = path.join(projectDir, "package.json");
  const content = await fs.readFile(pkgPath, "utf-8");
  return JSON.parse(content);
}

function toAuthorText(author) {
  if (!author) {
    return "";
  }
  if (typeof author === "string") {
    return author;
  }
  if (typeof author === "object") {
    return author.name || "";
  }
  return "";
}

function parseBuildTargetNames(rawTarget) {
  if (!rawTarget) {
    return [];
  }

  if (typeof rawTarget === "string") {
    return [rawTarget];
  }

  if (!Array.isArray(rawTarget)) {
    return [];
  }

  return rawTarget
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }
      if (item && typeof item === "object" && typeof item.target === "string") {
        return item.target;
      }
      return "";
    })
    .filter(Boolean);
}

async function inspectProjectDefaults(projectDirInput) {
  if (!projectDirInput || !projectDirInput.trim()) {
    throw new Error("请先选择项目目录。");
  }

  const projectDir = path.resolve(projectDirInput);
  const pkgPath = path.join(projectDir, "package.json");
  const hasPkg = fssync.existsSync(pkgPath);

  if (!hasPkg) {
    const htmlEntry = await findFirstHtmlFile(projectDir);
    if (!htmlEntry) {
      throw new Error("目录中没有 package.json，也没有 html 文件。");
    }

    return {
      defaults: {
        appId: "",
        productName: path.basename(projectDir),
        executableName: sanitizeName(path.basename(projectDir)),
        artifactName: "",
        version: "1.0.0",
        author: "",
        description: "",
        outputDir: "release",
        filesGlobs: "**/*\n!release/**",
        extraResources: "",
        asarUnpack: "",
        windowTitle: path.basename(projectDir),
        windowWidth: "1280",
        windowHeight: "800",
        windowShowMenuBar: true,
        windowFrame: true,
        windowResizable: true,
        windowFullscreenable: true,
        windowAlwaysOnTop: false,
        winIcon: resolveDefaultProjectIconPath(),
        linuxIcon: resolveDefaultProjectIconPath(),
        macIcon: resolveDefaultProjectIconPath(),
      },
      mode: "html-only",
      htmlEntry,
    };
  }

  const pkg = await readProjectManifest(projectDir);
  const build = pkg.build || {};
  const winTargetNames = parseBuildTargetNames(build.win && build.win.target);
  const linuxTargetNames = parseBuildTargetNames(build.linux && build.linux.target);
  const macTargetNames = parseBuildTargetNames(build.mac && build.mac.target);
  const electronVersion = resolveElectronVersionFromManifest(pkg, build);

  return {
    defaults: {
      appId: build.appId || "",
      productName: build.productName || pkg.productName || pkg.name || "",
      executableName: build.executableName || "",
      artifactName: build.artifactName || "",
      version: pkg.version || "",
      author: toAuthorText(pkg.author),
      description: pkg.description || "",
      outputDir:
        (build.directories && build.directories.output) || "release",
      electronVersion,
      chromiumVersion: "",
      nodeVersion: "",
      winTargets: winTargetNames
        .filter((target) => target.toLowerCase() !== "portable")
        .join(", "),
      winPortable: winTargetNames.some(
        (target) => target.toLowerCase() === "portable"
      ),
      linuxTargets: linuxTargetNames.join(", "),
      macTargets: macTargetNames.join(", "),
      filesGlobs: stringifyBuildArrayForForm(build.files),
      extraResources: stringifyBuildArrayForForm(build.extraResources),
      asarUnpack: stringifyBuildArrayForForm(build.asarUnpack),
      nsisShortcutName:
        build.nsis && typeof build.nsis.shortcutName === "string"
          ? build.nsis.shortcutName
          : "",
      nsisCreateDesktopShortcut:
        build.nsis && typeof build.nsis.createDesktopShortcut === "boolean"
          ? build.nsis.createDesktopShortcut
            ? "always"
            : "never"
          : "auto",
      nsisDeleteAppData:
        build.nsis && Boolean(build.nsis.deleteAppDataOnUninstall),
      windowTitle: build.productName || pkg.productName || pkg.name || "",
      windowWidth: "1280",
      windowHeight: "800",
      windowShowMenuBar: true,
      windowFrame: true,
      windowResizable: true,
      windowFullscreenable: true,
      windowAlwaysOnTop: false,
      winIcon: resolveDefaultProjectIconPath(),
      linuxIcon: resolveDefaultProjectIconPath(),
      macIcon: resolveDefaultProjectIconPath(),
    },
    mode: "electron-project",
  };
}

function buildTargetConfig(form) {
  const winTargets = parseCommaList(form.winTargets);
  const includePortable = Boolean(form.winPortable);
  if (includePortable) {
    const hasPortable = winTargets.some(
      (target) => target.toLowerCase() === "portable"
    );
    if (!hasPortable) {
      winTargets.push("portable");
    }
  }

  const config = {
    appId: form.appId || undefined,
    productName: form.productName || undefined,
    artifactName: form.artifactName || undefined,
    executableName: form.executableName || undefined,
    compression: form.compression || "normal",
    asar: Boolean(form.asar),
    npmRebuild: Boolean(form.npmRebuild),
    directories: {
      output: form.outputDir || "release",
    },
    files: parseLineItems(form.filesGlobs),
    asarUnpack: parseLineItems(form.asarUnpack),
    extraResources: parseLineItems(form.extraResources),
    extraMetadata: {
      version: form.version || undefined,
      description: form.description || undefined,
      author: form.author || undefined,
    },
    electronVersion: form.electronVersion || undefined,
  };

  if (!config.files.length) {
    delete config.files;
  }
  if (!config.extraResources.length) {
    delete config.extraResources;
  }
  if (!config.asarUnpack.length) {
    delete config.asarUnpack;
  }

  config.win = {
    icon: form.winIcon || undefined,
    target: winTargets,
    publisherName: form.publisherName || undefined,
  };

  config.nsis = {
    oneClick: Boolean(form.nsisOneClick),
    perMachine: Boolean(form.nsisPerMachine),
    allowElevation: Boolean(form.nsisAllowElevation),
    allowToChangeInstallationDirectory: Boolean(form.nsisAllowChangeDir),
    shortcutName: form.nsisShortcutName || undefined,
    createDesktopShortcut:
      form.nsisCreateDesktopShortcut === "always"
        ? true
        : form.nsisCreateDesktopShortcut === "never"
        ? false
        : undefined,
    deleteAppDataOnUninstall: Boolean(form.nsisDeleteAppData),
  };

  config.linux = {
    icon: form.linuxIcon || undefined,
    target: parseCommaList(form.linuxTargets),
    category: form.linuxCategory || undefined,
  };

  config.mac = {
    icon: form.macIcon || undefined,
    target: parseCommaList(form.macTargets),
    category: form.macCategory || undefined,
  };

  if (!config.win.target.length) {
    delete config.win.target;
  }
  if (!config.linux.target.length) {
    delete config.linux.target;
  }
  if (!config.mac.target.length) {
    delete config.mac.target;
  }

  if (!config.win.icon && !config.win.target && !config.win.publisherName) {
    delete config.win;
  }
  if (!config.linux.icon && !config.linux.target && !config.linux.category) {
    delete config.linux;
  }
  if (!config.mac.icon && !config.mac.target && !config.mac.category) {
    delete config.mac;
  }

  Object.keys(config.extraMetadata).forEach((key) => {
    if (!config.extraMetadata[key]) {
      delete config.extraMetadata[key];
    }
  });
  if (Object.keys(config.extraMetadata).length === 0) {
    delete config.extraMetadata;
  }
  if (!config.electronVersion) {
    delete config.electronVersion;
  }

  return config;
}

function isSelfBuildProject(projectDir) {
  try {
    const pkgPath = path.join(projectDir, "package.json");
    if (!fssync.existsSync(pkgPath)) {
      return false;
    }

    const pkg = JSON.parse(fssync.readFileSync(pkgPath, "utf-8"));
    return pkg && pkg.name === "html2exe";
  } catch (error) {
    return false;
  }
}

function injectSelfBuildToolchainResources(projectDir, config) {
  if (!isSelfBuildProject(projectDir)) {
    return config;
  }

  const toolchainResource = {
    from: "vendor/toolchain/node_modules",
    to: "embedded/toolchain/node_modules",
  };

  const existing = Array.isArray(config.extraResources) ? config.extraResources : [];
  const hasToolchainResource = existing.some((item) => {
    if (!item || typeof item !== "object") {
      return false;
    }

    return item.from === toolchainResource.from && item.to === toolchainResource.to;
  });

  if (!hasToolchainResource) {
    config.extraResources = [...existing, toolchainResource];
  }

  return config;
}

function normalizeBuildForm(form, onLog = noop) {
  const normalized = { ...form };

  // Windows target paths in electron-builder may require app.asar integrity info.
  // Keep asar enabled to avoid ENOENT on win-unpacked/resources/app.asar.
  if (normalized.targetWindows && !normalized.asar) {
    normalized.asar = true;
    onLog("检测到 Windows 打包，已自动开启 asar 以避免 app.asar 缺失导致构建失败。\n");
  }

  return normalized;
}

function sanitizeIconInput(iconPath) {
  const raw = String(iconPath || "").trim();
  if (!raw) {
    return "";
  }

  // 兼容手工粘贴时带引号的路径，例如 "D:\\icons\\app.ico"。
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1).trim();
  }

  return raw;
}

function resolveIconPathAgainstProject(iconPath, projectDir) {
  const cleaned = sanitizeIconInput(iconPath);
  if (!cleaned) {
    return "";
  }

  if (path.isAbsolute(cleaned)) {
    return cleaned;
  }

  if (projectDir) {
    return path.resolve(projectDir, cleaned);
  }

  return path.resolve(cleaned);
}

async function materializeIconPathForBuilder(iconPath, platformKey, projectDir = "", onLog = noop) {
  const raw = sanitizeIconInput(iconPath);
  if (!raw) {
    return "";
  }

  const resolvedRaw = resolveIconPathAgainstProject(raw, projectDir);

  if (!(await pathExists(resolvedRaw))) {
    const defaultIcon = resolveDefaultProjectIconPath();
    if (defaultIcon) {
      onLog(
        `警告: ${platformKey} 图标路径不存在 (${resolvedRaw})，已回退到默认图标: ${defaultIcon}\n`
      );
      return defaultIcon;
    }

    onLog(`警告: ${platformKey} 图标路径不存在 (${resolvedRaw})，且默认图标也不可用，已跳过图标配置。\n`);
    return "";
  }

  const normalized = resolvedRaw.replace(/\\/g, "/").toLowerCase();
  if (!normalized.includes("/app.asar/")) {
    return resolvedRaw;
  }

  const ext = path.extname(resolvedRaw) || ".png";
  const iconCacheDir = path.join(CACHE_PATHS.builderTemp, "runtime-assets");
  try {
    await fs.mkdir(iconCacheDir, { recursive: true });

    const targetPath = path.join(iconCacheDir, `icon-${platformKey}${ext}`);
    await fs.copyFile(resolvedRaw, targetPath);
    onLog(`检测到 asar 内图标路径，已落地为临时文件: ${targetPath}\n`);
    return targetPath;
  } catch (error) {
    const detail = error && error.message ? error.message : String(error || "未知错误");
    onLog(`警告: 无法从 asar 中提取 ${platformKey} 图标，已自动禁用该平台图标配置: ${detail}\n`);
    return "";
  }
}

async function materializeBuildIconsForExternalTools(config, projectDir = "", onLog = noop) {
  if (!config || typeof config !== "object") {
    return;
  }

  if (config.win && config.win.icon) {
    config.win.icon = await materializeIconPathForBuilder(config.win.icon, "win", projectDir, onLog);
    if (!config.win.icon) {
      delete config.win.icon;
    } else {
      onLog(`Windows 图标最终路径: ${config.win.icon}\n`);
    }
  }
  if (config.linux && config.linux.icon) {
    config.linux.icon = await materializeIconPathForBuilder(config.linux.icon, "linux", projectDir, onLog);
    if (!config.linux.icon) {
      delete config.linux.icon;
    } else {
      onLog(`Linux 图标最终路径: ${config.linux.icon}\n`);
    }
  }
  if (config.mac && config.mac.icon) {
    config.mac.icon = await materializeIconPathForBuilder(config.mac.icon, "mac", projectDir, onLog);
    if (!config.mac.icon) {
      delete config.mac.icon;
    } else {
      onLog(`macOS 图标最终路径: ${config.mac.icon}\n`);
    }
  }
}

async function ensureProjectDependencies(projectDir, runtime, onLog = noop, onStatus = noop) {
  const pkgPath = path.join(projectDir, "package.json");
  if (!(await pathExists(pkgPath))) {
    return;
  }

  const nodeModulesPath = path.join(projectDir, "node_modules");
  if (await pathExists(nodeModulesPath)) {
    onLog("检测到项目 node_modules 已存在，跳过依赖安装。\n");
    updateStep(onStatus, STEP_KEYS.INSTALL, "done", "依赖已就绪（跳过安装）");
    return;
  }

  const sourceIsHtmlOnlyBootstrap = path.basename(projectDir).startsWith("electron-html-pack-");
  if (sourceIsHtmlOnlyBootstrap) {
    onLog("纯 HTML 自动补全项目无需预装 node_modules，跳过依赖安装。\n");
    updateStep(onStatus, STEP_KEYS.INSTALL, "done", "纯 HTML 模式无需安装依赖");
    return;
  }

  updateStep(onStatus, STEP_KEYS.INSTALL, "running", "安装项目依赖中");
  onLog("检测到项目缺少依赖，正在自动安装（先装依赖再打包）...\n");

  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const systemNpmAvailable = hasExecutable(npmCommand);
  const bundledNpmCli = systemNpmAvailable ? "" : resolveBundledNpmCliPath();

  if (!systemNpmAvailable && !bundledNpmCli) {
    const checkedRoots = collectBundledNodeModuleRoots();
    onLog(`内置 npm-cli 检索路径: ${checkedRoots.join(" | ")}\n`);
    throw new Error("当前环境未检测到 npm，且未找到内置 npm-cli，无法自动安装项目依赖。请使用带内置工具链的新版本重新打包本工具。");
  }
  const hasPackageLock = await pathExists(path.join(projectDir, "package-lock.json"));
  const installArgs = [
    hasPackageLock ? "ci" : "install",
    "--include=dev",
    "--no-audit",
    "--no-fund",
    "--include=optional",
  ];

  let command;
  let args;
  let env;

  if (systemNpmAvailable) {
    command = npmCommand;
    args = installArgs;
    env = {
      ...process.env,
      npm_config_cache: CACHE_PATHS.npmCache,
      NPM_CONFIG_CACHE: CACHE_PATHS.npmCache,
    };
    onLog(`使用系统 npm 安装项目依赖: ${npmCommand} ${installArgs.join(" ")}\n`);
  } else {
    command = runtime.command;
    args = [bundledNpmCli, ...installArgs];
    env = {
      ...process.env,
      npm_config_cache: CACHE_PATHS.npmCache,
      NPM_CONFIG_CACHE: CACHE_PATHS.npmCache,
    };
    if (runtime.mode === "electron-node") {
      env.ELECTRON_RUN_AS_NODE = "1";
    }
    onLog(`系统 npm 不可用，改用内置 npm-cli 安装项目依赖: ${bundledNpmCli}\n`);
  }

  const installResult = await runCommandCapture(command, args, {
    cwd: projectDir,
    windowsHide: true,
    env,
  });

  if (installResult.code !== 0) {
    updateStep(onStatus, STEP_KEYS.INSTALL, "failed", "项目依赖安装失败");
    const detail = (installResult.stderr || installResult.stdout || "").trim();
    throw new Error(`项目依赖安装失败: ${detail || `npm 退出码 ${installResult.code}`}`);
  }

  updateStep(onStatus, STEP_KEYS.INSTALL, "done", "项目依赖安装完成");
  onLog("项目依赖安装完成，开始进入打包阶段。\n");
}

function applyRuntimeVersionOverrides(form, childEnv, onLog = noop) {
  const electronVersion = normalizeVersionInput(form.electronVersion);
  const chromiumVersion = normalizeVersionInput(form.chromiumVersion);
  const nodeVersion = normalizeVersionInput(form.nodeVersion);

  if (electronVersion) {
    childEnv.npm_config_target = electronVersion;
    childEnv.NPM_CONFIG_TARGET = electronVersion;
    childEnv.npm_config_runtime = "electron";
    childEnv.NPM_CONFIG_RUNTIME = "electron";
    childEnv.npm_config_disturl = "https://electronjs.org/headers";
    childEnv.NPM_CONFIG_DISTURL = "https://electronjs.org/headers";
  }

  if (chromiumVersion) {
    childEnv.CHROMIUM_VERSION = chromiumVersion;
    childEnv.npm_config_chromium_version = chromiumVersion;
    childEnv.NPM_CONFIG_CHROMIUM_VERSION = chromiumVersion;
  }

  if (nodeVersion) {
    childEnv.NODE_VERSION = nodeVersion;
    childEnv.npm_config_node_version = nodeVersion;
    childEnv.NPM_CONFIG_NODE_VERSION = nodeVersion;
  }

  const runtimeSegments = [];
  if (electronVersion) {
    runtimeSegments.push(`Electron=${electronVersion}`);
  }
  if (chromiumVersion) {
    runtimeSegments.push(`Chromium=${chromiumVersion}`);
  }
  if (nodeVersion) {
    runtimeSegments.push(`Node.js=${nodeVersion}`);
  }

  if (runtimeSegments.length > 0) {
    onLog(`已应用运行时高级版本覆盖: ${runtimeSegments.join(", ")}\n`);
  }
}

async function prepareWorkspaceForBuild(form, onLog, onStatus = noop) {
  const sourceDir = path.resolve(form.projectDir);
  const pkgPath = path.join(sourceDir, "package.json");
  const hasPkg = fssync.existsSync(pkgPath);

  if (hasPkg) {
    if (hasWindowUiOverride(form)) {
      onLog("提示: 界面窗口选项仅对纯 HTML 自动补全模式生效，现有 Electron 项目将使用其自身窗口代码。\n");
    }
    return {
      projectDir: sourceDir,
      cleanup: async () => {},
      normalizedForm: form,
      htmlOnly: false,
    };
  }

  updateStep(onStatus, STEP_KEYS.TEMP_PROJECT, "running", "创建临时 Electron 项目");

  const htmlEntry = await findFirstHtmlFile(sourceDir);
  if (!htmlEntry) {
    throw new Error("目录缺少 package.json，且未找到任何 .html 文件，无法自动补全打包。");
  }

  onLog("检测到纯 HTML 项目，正在自动补全 Electron 打包结构...\n");

  const tempProjectDir = path.join(
    CACHE_PATHS.builderTemp,
    `electron-html-pack-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
  );
  const appSourceDir = path.join(tempProjectDir, "app-source");
  const appIconsDir = path.join(tempProjectDir, "app-icons");
  await fs.mkdir(appSourceDir, { recursive: true });
  await fs.mkdir(appIconsDir, { recursive: true });

  const runtimeIconRelative = {
    win32: "",
    linux: "",
    darwin: "",
  };

  const htmlOnlyBuildIcons = {
    winIcon: "",
    linuxIcon: "",
    macIcon: "",
  };

  const runtimeIconCandidates = [
    ["win32", form.winIcon],
    ["linux", form.linuxIcon],
    ["darwin", form.macIcon],
  ];

  for (const [platformKey, iconInput] of runtimeIconCandidates) {
    const resolvedIconPath = resolveIconPathAgainstProject(iconInput || "", sourceDir);
    if (!resolvedIconPath || !(await pathExists(resolvedIconPath))) {
      continue;
    }

    const iconExt = path.extname(resolvedIconPath) || ".png";
    const targetBaseName = `icon-${platformKey}${iconExt}`;
    const targetPath = path.join(appIconsDir, targetBaseName);

    try {
      await fs.copyFile(resolvedIconPath, targetPath);
      runtimeIconRelative[platformKey] = path.join("app-icons", targetBaseName).replace(/\\/g, "/");
      if (platformKey === "win32") {
        htmlOnlyBuildIcons.winIcon = targetPath;
      } else if (platformKey === "linux") {
        htmlOnlyBuildIcons.linuxIcon = targetPath;
      } else if (platformKey === "darwin") {
        htmlOnlyBuildIcons.macIcon = targetPath;
      }
      onLog(`纯 HTML 模式已写入运行时图标(${platformKey}): ${targetPath}\n`);
    } catch (error) {
      const detail = error && error.message ? error.message : String(error || "未知错误");
      onLog(`警告: 复制纯 HTML 运行时图标失败(${platformKey}): ${detail}\n`);
    }
  }

  const requiredRuntimeIconChecks = [
    ["win32", form.winIcon, htmlOnlyBuildIcons.winIcon],
    ["linux", form.linuxIcon, htmlOnlyBuildIcons.linuxIcon],
    ["darwin", form.macIcon, htmlOnlyBuildIcons.macIcon],
  ];

  for (const [platformKey, configuredIcon, copiedIcon] of requiredRuntimeIconChecks) {
    const configured = String(configuredIcon || "").trim();
    if (configured && !copiedIcon) {
      throw new Error(`纯 HTML 模式复制图标失败(${platformKey})，已阻止继续打包以避免回退默认图标: ${configured}`);
    }
  }

  const windowOptions = getGeneratedWindowOptions(form);
  const mainJs = `const { app, BrowserWindow } = require("electron");\nconst fs = require("node:fs");\nconst path = require("node:path");\n\nconst WINDOW_OPTIONS = ${JSON.stringify(
    windowOptions,
    null,
    2
  )};\nconst WINDOW_ICON_RELATIVE = ${JSON.stringify(runtimeIconRelative, null, 2)};\n\nfunction resolveWindowIcon() {\n  const relativeIcon = WINDOW_ICON_RELATIVE[process.platform] || "";\n  if (!relativeIcon) {\n    return undefined;\n  }\n\n  const candidatePaths = [\n    path.join(process.resourcesPath || "", relativeIcon),\n    path.join(__dirname, relativeIcon),\n  ];\n\n  const absPath = candidatePaths.find((candidate) => candidate && fs.existsSync(candidate));\n  return absPath || undefined;\n}\n\nfunction createWindow() {\n  const { showMenuBar, ...browserWindowOptions } = WINDOW_OPTIONS;\n  const win = new BrowserWindow({\n    ...browserWindowOptions,\n    icon: resolveWindowIcon(),\n  });\n  win.setMenuBarVisibility(Boolean(showMenuBar));\n  win.loadFile(path.join(__dirname, "app-source", ${JSON.stringify(
    htmlEntry
  )}));\n}\n\napp.whenReady().then(createWindow);\napp.on("window-all-closed", () => {\n  if (process.platform !== "darwin") app.quit();\n});\n`;

  const fallbackName = sanitizeName(path.basename(sourceDir));
  const fixedElectronVersion = resolveLocalElectronVersion();
  const requestedElectronVersion = normalizeVersionInput(form.electronVersion) || fixedElectronVersion;
  const packageJson = {
    name: fallbackName,
    version: form.version || "1.0.0",
    description: form.description || "Auto generated from html directory",
    author: form.author || "",
    main: "main.js",
    private: true,
    devDependencies: {
      electron: requestedElectronVersion,
    },
  };

  await fs.writeFile(path.join(tempProjectDir, "main.js"), mainJs, "utf-8");
  await fs.writeFile(
    path.join(tempProjectDir, "package.json"),
    JSON.stringify(packageJson, null, 2),
    "utf-8"
  );

  onLog(`已自动补全临时项目: ${tempProjectDir}\n`);
  onLog("纯 HTML 模式将强制包含 main.js/package.json/app-source 以保证可运行。\n");
  updateStep(onStatus, STEP_KEYS.TEMP_PROJECT, "done", "临时项目创建完成");

  const normalizedFilesGlobs = normalizeHtmlOnlyFilesGlobs(form.filesGlobs);
  const requestedOutputDir = (form.outputDir || "release").trim() || "release";
  const resolvedOutputDir = path.isAbsolute(requestedOutputDir)
    ? requestedOutputDir
    : path.resolve(sourceDir, requestedOutputDir);
  onLog(`纯 HTML 模式产物输出目录: ${resolvedOutputDir}\n`);

  await fs.cp(sourceDir, appSourceDir, {
    recursive: true,
    force: true,
    filter: (src) => !shouldSkipHtmlCopyPath(sourceDir, resolvedOutputDir, src),
  });

  onLog("纯 HTML 模式将把 app-icons 作为 extraResources（resources/app-icons）写入产物，避免 asar 图标读取回退。\n");
  if (htmlOnlyBuildIcons.winIcon || htmlOnlyBuildIcons.linuxIcon || htmlOnlyBuildIcons.macIcon) {
    onLog(
      `纯 HTML 模式已改写构建图标路径: win=${htmlOnlyBuildIcons.winIcon || "(空)"}, linux=${htmlOnlyBuildIcons.linuxIcon || "(空)"}, mac=${htmlOnlyBuildIcons.macIcon || "(空)"}\n`
    );
  }

  const htmlOnlyExtraResources = parseLineItems(form.extraResources);
  const hasAppIconsResource = htmlOnlyExtraResources.some((item) => {
    if (!item || typeof item !== "object") {
      return false;
    }

    return item.from === "app-icons" && item.to === "app-icons";
  });

  if (!hasAppIconsResource) {
    htmlOnlyExtraResources.push({ from: "app-icons", to: "app-icons" });
  }

  return {
    projectDir: tempProjectDir,
    cleanup: async () => {
      await rmWithRetry(tempProjectDir, { recursive: true, force: true });
    },
    normalizedForm: {
      ...form,
      outputDir: resolvedOutputDir,
      filesGlobs: normalizedFilesGlobs,
      extraResources: stringifyBuildArrayForForm(htmlOnlyExtraResources),
      winIcon: htmlOnlyBuildIcons.winIcon || form.winIcon,
      linuxIcon: htmlOnlyBuildIcons.linuxIcon || form.linuxIcon,
      macIcon: htmlOnlyBuildIcons.macIcon || form.macIcon,
      asar: true,
      asarUnpack: form.asarUnpack || "",
      npmRebuild: false,
      electronVersion: requestedElectronVersion,
    },
    htmlOnly: true,
  };
}

async function runBuild(form, onLog, onStatus = noop) {
  if (activeBuild) {
    throw new Error("已有打包任务在运行，请先取消或等待当前任务完成。");
  }

  if (!form.projectDir || !form.projectDir.trim()) {
    throw new Error("请先选择要打包的 Electron 项目目录。");
  }

  updateOverall(onStatus, "running", "构建进行中");
  updateStep(onStatus, STEP_KEYS.PREPARE, "running", "准备构建参数");

  const projectDir = path.resolve(form.projectDir);
  const prepared = await prepareWorkspaceForBuild(form, onLog, onStatus);
  updateStep(onStatus, STEP_KEYS.PREPARE, "done", "构建参数准备完成");
  const buildProjectDir = prepared.projectDir;
  const pkg = await readProjectManifest(buildProjectDir);
  if (!pkg.name) {
    throw new Error("目标项目缺少有效名称，无法打包。");
  }

  const normalizedForm = normalizeBuildForm(prepared.normalizedForm, onLog);
  if (!normalizedForm.electronVersion) {
    normalizedForm.electronVersion = resolveLocalElectronVersion();
  }
  const runtime = resolveBuilderRuntime();
  await ensureProjectDependencies(buildProjectDir, runtime, onLog, onStatus);

  const config = injectSelfBuildToolchainResources(buildProjectDir, buildTargetConfig(normalizedForm));

  if (prepared.htmlOnly) {
    const beforeBuildHookPath = path.join(buildProjectDir, "builder-before-build.cjs");
    const beforeBuildHookContent = [
      "module.exports = async function beforeBuildSkipNodeModules() {",
      "  return false;",
      "};",
      "",
    ].join("\n");

    await fs.writeFile(beforeBuildHookPath, beforeBuildHookContent, "utf-8");
    // 让 electron-builder 在 beforeBuild 返回 false 后进入“外部处理 node_modules”模式，
    // 从而跳过 package manager 依赖树收集（无 Node.js 环境也可打包纯 HTML 项目）。
    config.npmRebuild = true;
    config.beforeBuild = beforeBuildHookPath;
    config.nodeGypRebuild = false;

    const defaultWinIconPath = resolveDefaultProjectIconPath();
    const requestedWinIconPath = resolveIconPathAgainstProject(form.winIcon || "", projectDir);
    const hasCustomWindowsIcon = Boolean(requestedWinIconPath) &&
      (!defaultWinIconPath ||
        path.resolve(requestedWinIconPath).toLowerCase() !== path.resolve(defaultWinIconPath).toLowerCase());

    // 兼容非管理员/未开启开发者模式的 Windows：
    // 无自定义图标时跳过 exe 资源编辑，降低 winCodeSign 压缩包解压符号链接失败概率。
    // 有自定义图标时保留资源编辑，否则 Windows 可执行文件图标不会生效。
    if (!config.win || typeof config.win !== "object") {
      config.win = {};
    }
    config.win.signAndEditExecutable = hasCustomWindowsIcon;
    config.forceCodeSigning = false;
    onLog("纯 HTML 模式已启用 beforeBuild 跳过依赖扫描策略（兼容无 Node.js 环境）。\n");
    if (hasCustomWindowsIcon) {
      onLog("检测到自定义 Windows 图标，已启用 exe 资源编辑以确保图标生效。\n");
    } else {
      const existingWinTargets = Array.isArray(config.win.target)
        ? config.win.target
        : [];
      onLog("纯 HTML 模式已启用 Windows 受限环境兼容策略（跳过 exe 资源编辑/签名）。\n");

      const installerRequested = existingWinTargets.some((target) => {
        const lower = String(target || "").trim().toLowerCase();
        return lower === "nsis" || lower === "nsis-web";
      });

      if (installerRequested) {
        // 即使选择了 NSIS，也禁用签名以避免 Windows 权限限制导致的符号链接失败
        // 改为关闭所有代码签名相关功能，生成未签名的可执行文件和安装包
        config.win.signAndEditExecutable = false;
        config.forceCodeSigning = false;
        onLog("检测到已选择 Windows 安装包目标（nsis/nsis-web），但已禁用 exe 资源编辑/签名以绕过权限限制。\n");
      } else {
        if (existingWinTargets.length === 0) {
          // 未显式指定目标时，electron-builder 的 Windows 默认目标即安装包（nsis）。
          // 这里保持默认行为，避免把“默认安装包”误降级成 dir。
          onLog("未显式指定 Windows 目标，保留 electron-builder 默认安装包策略（nsis）。\n");
        } else {
          const safeWinTargets = existingWinTargets
            .map((target) => String(target || "").trim())
            .filter(Boolean)
            .filter((target) => {
              const lower = target.toLowerCase();
              return lower !== "nsis" && lower !== "nsis-web";
            });

          // Windows 受限环境里 NSIS 阶段会调用 app-builder.exe，易触发 0xC0000142。
          // 未选择安装包时，若去掉 NSIS 后无其它目标，则回退为 dir，确保至少产出可运行目录。
          if (safeWinTargets.length === 0) {
            safeWinTargets.push("dir");
          }

          config.win.target = safeWinTargets;
          delete config.nsis;
          onLog(`纯 HTML 模式已自动调整 Windows 目标为: ${safeWinTargets.join(", ")}（未选择安装包，已跳过 NSIS）。\n`);
        }
      }
    }
  }

  await materializeBuildIconsForExternalTools(config, projectDir, onLog);

  const tempConfigPath = path.join(
    CACHE_PATHS.builderTemp,
    `electron-builder-ui-${Date.now()}.json`
  );
  await fs.writeFile(tempConfigPath, JSON.stringify(config, null, 2), "utf-8");

  const args = [
    "build",
    "--projectDir",
    buildProjectDir,
    "--config",
    tempConfigPath,
  ];
  const launcher = await resolveBuilderLauncher(runtime, onLog);

  const childEnv = {
    ...process.env,
    TEMP: CACHE_PATHS.appTemp,
    TMP: CACHE_PATHS.appTemp,
    TMPDIR: CACHE_PATHS.appTemp,
    XDG_CACHE_HOME: LOCAL_CACHE_ROOT,
    EBUILDER_CACHE: CACHE_PATHS.builderCache,
    ELECTRON_BUILDER_CACHE: CACHE_PATHS.builderCache,
    ELECTRON_CACHE: CACHE_PATHS.electronDownloadCache,
    npm_config_cache: CACHE_PATHS.npmCache,
    NPM_CONFIG_CACHE: CACHE_PATHS.npmCache,
  };

  const normalizedMirror = normalizeMirrorBaseUrl(
    childEnv.ELECTRON_BUILDER_BINARIES_MIRROR || ELECTRON_BUILDER_BINARIES_MIRROR_DEFAULT
  );

  if (!childEnv.ELECTRON_BUILDER_BINARIES_MIRROR) {
    childEnv.ELECTRON_BUILDER_BINARIES_MIRROR = normalizedMirror;
    onLog(`未检测到 ELECTRON_BUILDER_BINARIES_MIRROR，已使用默认镜像: ${normalizedMirror}\n`);
  } else if (childEnv.ELECTRON_BUILDER_BINARIES_MIRROR !== normalizedMirror) {
    childEnv.ELECTRON_BUILDER_BINARIES_MIRROR = normalizedMirror;
    onLog(`已自动规范化 ELECTRON_BUILDER_BINARIES_MIRROR: ${normalizedMirror}\n`);
  }

  const electronMirrorDefault = normalizeMirrorBaseUrl(
    childEnv.ELECTRON_MIRROR || "https://npmmirror.com/mirrors/electron/"
  );
  if (!childEnv.ELECTRON_MIRROR) {
    childEnv.ELECTRON_MIRROR = electronMirrorDefault;
    onLog(`未检测到 ELECTRON_MIRROR，已使用默认镜像: ${electronMirrorDefault}\n`);
  } else if (childEnv.ELECTRON_MIRROR !== electronMirrorDefault) {
    childEnv.ELECTRON_MIRROR = electronMirrorDefault;
    onLog(`已自动规范化 ELECTRON_MIRROR: ${electronMirrorDefault}\n`);
  }
  childEnv.npm_config_electron_mirror = childEnv.ELECTRON_MIRROR;
  childEnv.NPM_CONFIG_ELECTRON_MIRROR = childEnv.ELECTRON_MIRROR;

  applyRuntimeVersionOverrides(normalizedForm, childEnv, onLog);

  if (runtime.mode === "electron-node") {
    childEnv.ELECTRON_RUN_AS_NODE = "1";
    childEnv.ELECTRON_NO_ASAR = "1";
  }

  if (prepared.htmlOnly) {
    childEnv.CSC_IDENTITY_AUTO_DISCOVERY = "false";
  }

  for (const arch of parseArchFlags(normalizedForm.arches)) {
    args.push(`--${arch}`);
  }

  if (normalizedForm.targetWindows) {
    args.push("--win");
  }
  if (normalizedForm.targetLinux) {
    args.push("--linux");
  }
  if (normalizedForm.targetMac) {
    args.push("--mac");
  }
  if (
    !normalizedForm.targetWindows &&
    !normalizedForm.targetLinux &&
    !normalizedForm.targetMac
  ) {
    onLog("未选择平台，electron-builder 将使用项目默认配置。\n");
  }

  const finalCommand = [...launcher.prefixArgs, ...args].join(" ");
  onLog(
    `执行命令: ${launcher.command} ${finalCommand}\n`
  );
  onLog(`已选择构建器入口: ${launcher.description}（${launcher.mode}）。\n`);

  return new Promise((resolve, reject) => {
    const child = spawn(
      launcher.command,
      [...launcher.prefixArgs, ...args],
      {
        cwd: buildProjectDir,
        env: childEnv,
        stdio: "pipe",
      }
    );

    const session = {
      child,
      tempConfigPath,
      cleanupProject: prepared.cleanup,
      stepMarks: {
        installStarted: false,
        installCompleted: false,
        packageStarted: false,
        artifactStarted: false,
      },
      canceled: false,
      startMs: Date.now(),
    };
    activeBuild = session;

    async function cleanup() {
      try {
        await rmWithRetry(tempConfigPath, { force: true });
      } catch (error) {
        onLog(`清理临时配置文件失败（已忽略）: ${error.message}\n`);
      }

      try {
        await session.cleanupProject();
      } catch (error) {
        onLog(`清理临时项目目录失败（已忽略）: ${error.message}\n`);
      }

      if (activeBuild === session) {
        activeBuild = null;
      }
    }

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      onLog(text);
      handleBuilderChunk(text, session.stepMarks, onStatus);
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      onLog(text);
      handleBuilderChunk(text, session.stepMarks, onStatus);
    });

    child.on("error", async (error) => {
      await cleanup();
      updateOverall(onStatus, "failed", "构建启动失败");
      updateStep(onStatus, STEP_KEYS.COMPLETE, "failed", "构建失败");
      reject(new Error(`启动打包进程失败: ${error.message}`));
    });

    child.on("close", async (code) => {
      await cleanup();
      const durationMs = Date.now() - session.startMs;

      if (session.canceled) {
        updateOverall(onStatus, "canceled", "构建已取消");
        updateStep(onStatus, STEP_KEYS.COMPLETE, "failed", "构建已取消");
        resolve({ success: false, canceled: true, code, durationMs });
        return;
      }

      if (code === 0) {
        if (!session.stepMarks.installCompleted) {
          updateStep(onStatus, STEP_KEYS.INSTALL, "done", "依赖安装完成");
        }
        if (!session.stepMarks.packageStarted) {
          updateStep(onStatus, STEP_KEYS.PACKAGE, "done", "应用封装完成");
        } else {
          updateStep(onStatus, STEP_KEYS.PACKAGE, "done", "应用封装完成");
        }
        updateStep(onStatus, STEP_KEYS.ARTIFACT, "done", "安装包生成完成");
        updateStep(onStatus, STEP_KEYS.COMPLETE, "done", "构建成功");
        updateOverall(onStatus, "success", "构建成功");
        resolve({ success: true, code, durationMs });
      } else {
        updateOverall(onStatus, "failed", "构建失败");
        updateStep(onStatus, STEP_KEYS.COMPLETE, "failed", "构建失败");
        reject(new Error(`打包失败，退出码: ${code}`));
      }
    });
  });
}

app.whenReady().then(() => {
  cleanupLegacyTempArtifacts().catch(noop);
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

ipcMain.handle("dialog:pickProject", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
    title: "选择要打包的 Electron 项目目录",
  });

  if (result.canceled || result.filePaths.length === 0) {
    return "";
  }

  return result.filePaths[0];
});

ipcMain.handle("dialog:pickOutput", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory", "createDirectory"],
    title: "选择打包输出目录",
  });

  if (result.canceled || result.filePaths.length === 0) {
    return "";
  }

  return result.filePaths[0];
});

ipcMain.handle("dialog:pickIcon", async (_, extensions) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    filters: [
      {
        name: "Icon",
        extensions:
          Array.isArray(extensions) && extensions.length > 0
            ? extensions
            : ["ico", "icns", "png"],
      },
      { name: "All Files", extensions: ["*"] },
    ],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return "";
  }

  return result.filePaths[0];
});

ipcMain.handle("settings:load", async () => {
  const saved = await readSettings();
  return {
    ...getDefaultFormSettings(),
    ...(saved || {}),
  };
});

ipcMain.handle("settings:save", async (_, settings) => {
  const current = await readSettings();
  await writeSettings({
    ...(current || {}),
    ...(settings || {}),
  });
  return { success: true };
});

ipcMain.handle("project:inspect", async (_, projectDir) => {
  try {
    const result = await inspectProjectDefaults(projectDir);
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("builder:cancel", async () => {
  if (!activeBuild || !activeBuild.child) {
    return { success: false, error: "当前没有正在运行的打包任务。" };
  }

  activeBuild.canceled = true;
  const killed = activeBuild.child.kill();
  if (!killed) {
    return { success: false, error: "取消请求已发送，但进程暂未响应。" };
  }
  return { success: true };
});

ipcMain.handle("cache:clear", async () => {
  if (activeBuild) {
    return { success: false, error: "构建进行中，暂不能清理缓存。" };
  }

  try {
    const result = await clearLocalCaches();
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("builder:run", async (_, form) => {
  if (!mainWindow) {
    throw new Error("窗口未初始化。");
  }

  try {
    const result = await runBuild(
      form,
      (line) => {
        mainWindow.webContents.send("builder:log", line);
      },
      (payload) => {
        mainWindow.webContents.send("builder:status", payload);
      }
    );
    return { success: true, result };
  } catch (error) {
    mainWindow.webContents.send("builder:log", `${error.message}\n`);
    mainWindow.webContents.send("builder:status", {
      type: "overall",
      state: "failed",
      text: error.message,
    });
    return { success: false, error: error.message };
  }
});
