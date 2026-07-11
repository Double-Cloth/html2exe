const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const fssync = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function createPersistentPortableNsiScript(script) {
  const source = String(script || "");
  const flexibleNewline = "\\r?\\n\\s*";
  const tempDirBlockPattern = new RegExp(
    [
      ' StrCpy \\$INSTDIR "\\$PLUGINSDIR\\\\app"',
      "!ifdef UNPACK_DIR_NAME",
      'StrCpy \\$INSTDIR "\\$TEMP\\\\\\$\\{UNPACK_DIR_NAME\\}"',
      "!endif",
    ].join(flexibleNewline)
  );
  const persistentDirBlock = [
    ' StrCpy $INSTDIR "$PLUGINSDIR\\app"',
    " !ifdef UNPACK_DIR_NAME",
    ' StrCpy $INSTDIR "$EXEDIR\\${UNPACK_DIR_NAME}"',
    " !endif",
  ].join("\n");

  if (!tempDirBlockPattern.test(source)) {
    throw new Error("当前 electron-builder portable.nsi 模板结构不匹配，无法启用当前目录持久化绿色版。");
  }

  const withVisibleProgress = source
    .replace(
      /(AutoCloseWindow\s+True[^\S\r\n]*(?:\r?\n))/,
      'LoadLanguageFile "${NSISDIR}\\Contrib\\Language files\\English.nlf"\n$1'
    )
    .replace(
      /(AutoCloseWindow\s+True[^\S\r\n]*(?:\r?\n))/,
      "$1ShowInstDetails show\n"
    )
    .replace(
      /(RequestExecutionLevel\s+\$\{REQUEST_EXECUTION_LEVEL\}[^\S\r\n]*(?:\r?\n))/,
      "$1Page instfiles\n"
    )
    .replace(
      /([ \t]*)!ifndef SPLASH_IMAGE[^\S\r\n]*(?:\r?\n)[ \t]*SetSilent silent[^\S\r\n]*(?:\r?\n)[ \t]*!endif/,
      "$1; Self-extract mode shows the extraction progress window."
    );
  const withPersistentDir = withVisibleProgress.replace(tempDirBlockPattern, persistentDirBlock);
  const launchAppPattern =
    /^([ \t]*)ExecWait\s+"\$INSTDIR\\\$\{APP_EXECUTABLE_FILENAME\}[^"]*"\s+\$0[^\S\r\n]*(?:\r?\n[ \t]*SetErrorLevel\s+\$0[^\S\r\n]*)?/m;
  const withoutLaunch = withPersistentDir.replace(
    launchAppPattern,
    "$1; Self-extract mode does not launch the app after extraction."
  );
  const exitCleanupPattern = /([ \t]*SetOutPath \$EXEDIR[^\S\r\n]*(?:\r?\n)(?:[ \t]*(?:\r?\n))*)([ \t]*)RMDir \/r \$INSTDIR(?=\r?\n|$)/;
  if (!exitCleanupPattern.test(withoutLaunch)) {
    throw new Error("当前 electron-builder portable.nsi 未找到退出清理语句，无法安全 patch。");
  }

  return withoutLaunch.replace(
    exitCleanupPattern,
    "$1$2RMDir /r \"$$PLUGINSDIR\"\n$2MessageBox MB_OK \"Extraction complete.\"\n$2; persistent portable mode keeps unpacked files beside the executable."
  );
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
      } catch (error) {}
    }

    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return "";
}

function resolveLocalBuilderCliPath() {
  return require.resolve("electron-builder/cli.js", { paths: [PROJECT_ROOT] });
}

function resolveElectronBuilderRunnerPath() {
  return path.join(__dirname, "electron-builder-runner.js");
}

function resolvePortableTemplatePathFromBuilderCli(builderCliPath) {
  const builderPackageRoot = resolveBuilderPackageRootFromCli(builderCliPath);
  if (!builderPackageRoot) {
    return "";
  }

  const nodeModulesRoot = path.dirname(builderPackageRoot);
  const candidates = [
    path.join(nodeModulesRoot, "app-builder-lib", "templates", "nsis", "portable.nsi"),
    path.join(builderPackageRoot, "node_modules", "app-builder-lib", "templates", "nsis", "portable.nsi"),
  ];

  return candidates.find((candidate) => fssync.existsSync(candidate)) || "";
}

function shouldPatchPortableTemplate(argv = [], platform = process.platform) {
  const args = argv.map((arg) => String(arg || "").toLowerCase());
  const hasWindowsTarget = args.some((arg) => arg === "--win" || arg === "--windows" || arg.startsWith("--win="));
  if (hasWindowsTarget) {
    return true;
  }

  const hasOtherPlatformTarget = args.some(
    (arg) =>
      arg === "--linux" ||
      arg.startsWith("--linux=") ||
      arg === "--mac" ||
      arg === "--macos" ||
      arg.startsWith("--mac=")
  );
  if (hasOtherPlatformTarget) {
    return false;
  }

  return platform === "win32";
}

function getPreBuildCleanupTargets(argv = [], platform = process.platform, projectRoot = PROJECT_ROOT) {
  if (!shouldPatchPortableTemplate(argv, platform)) {
    return [];
  }

  return [
    path.join(projectRoot, "dist", "win-unpacked"),
    path.join(projectRoot, "dist", "win-unpacked.tmp"),
  ];
}

function hasOutputOverride(argv = []) {
  return argv.some((arg) => {
    const value = String(arg || "").toLowerCase();
    return (
      value.startsWith("-c.directories.output=") ||
      value.startsWith("--config.directories.output=")
    );
  });
}

function resolveSelfBuildOutputRoot(options = {}) {
  return path.resolve(options.selfBuildOutputRoot || path.join(os.tmpdir(), "html2exe-self-build"));
}

function createBuildInvocation(argv = [], options = {}) {
  const projectRoot = options.projectRoot || PROJECT_ROOT;
  const platform = options.platform || process.platform;
  const buildId = options.buildId || `build-${Date.now()}-${process.pid}`;
  const finalOutputDir = path.join(projectRoot, "dist");
  const isolated = shouldPatchPortableTemplate(argv, platform) && !hasOutputOverride(argv);

  if (!isolated) {
    return {
      argv: [...argv],
      cleanupRoots: [],
      finalOutputDir,
      isolated: false,
      outputDir: "",
    };
  }

  const selfBuildOutputRoot = resolveSelfBuildOutputRoot(options);
  const outputDir = path.join(selfBuildOutputRoot, buildId);

  return {
    argv: [...argv, `-c.directories.output=${outputDir}`],
    cleanupRoots: [selfBuildOutputRoot],
    finalOutputDir,
    isolated: true,
    outputDir,
  };
}

function isPathInsideAllowedRoot(targetPath, rootPath) {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedTarget = path.resolve(targetPath);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  return Boolean(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertInsideAllowedRoots(targetPath, roots) {
  const resolvedTarget = path.resolve(targetPath);
  if (!roots.some((rootPath) => isPathInsideAllowedRoot(resolvedTarget, rootPath))) {
    throw new Error(`拒绝清理允许目录外的路径: ${resolvedTarget}`);
  }
}

async function removePathWithRetry(targetPath, options = {}) {
  assertInsideAllowedRoots(targetPath, [
    options.projectRoot || PROJECT_ROOT,
    ...(options.allowedRoots || []),
  ]);

  const attempts = options.attempts || 6;
  const retryDelayMs = options.retryDelayMs || 500;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await fs.rm(targetPath, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!["EPERM", "EBUSY", "ENOTEMPTY"].includes(error && error.code)) {
        throw error;
      }
      if (attempt === attempts) {
        throw new Error(
          `无法清理旧的 Windows 构建目录: ${targetPath}\n` +
            "请关闭正在运行的 html2exe.exe / Electron 进程、资源管理器预览窗口或杀毒软件占用后重试。"
        );
      }
      await delay(retryDelayMs);
    }
  }
}

async function cleanupPreBuildOutputs(argv = [], options = {}) {
  const projectRoot = options.projectRoot || PROJECT_ROOT;
  const targets = getPreBuildCleanupTargets(argv, options.platform, projectRoot);
  for (const targetPath of targets) {
    await removePathWithRetry(targetPath, {
      projectRoot,
      attempts: options.attempts,
      retryDelayMs: options.retryDelayMs,
    });
  }
}

async function publishTopLevelExecutables(outputDir, finalOutputDir, options = {}) {
  await fs.mkdir(finalOutputDir, { recursive: true });
  const entries = await fs.readdir(outputDir, { withFileTypes: true });
  const executables = entries.filter(
    (entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".exe")
  );

  if (executables.length === 0) {
    throw new Error(`构建已完成，但未在临时输出目录找到可发布的 EXE: ${outputDir}`);
  }

  for (const entry of executables) {
    const from = path.join(outputDir, entry.name);
    const to = path.join(finalOutputDir, entry.name);
    try {
      await fs.copyFile(from, to);
    } catch (error) {
      if (["EPERM", "EBUSY"].includes(error && error.code)) {
        throw new Error(
          `无法写入最终产物: ${to}\n` +
            "请关闭正在运行的旧 EXE、资源管理器预览窗口或杀毒软件占用后重试。"
        );
      }
      throw error;
    }
  }

  if (options.log !== false) {
    console.log(`已发布自打包产物到 ${finalOutputDir}`);
  }
}

async function applyPersistentPortableTemplatePatch(builderCliPath) {
  const templatePath = resolvePortableTemplatePathFromBuilderCli(builderCliPath);
  if (!templatePath) {
    throw new Error("无法定位 electron-builder portable.nsi 模板，不能生成当前目录持久化绿色版。");
  }

  const originalScript = await fs.readFile(templatePath, "utf-8");
  const patchedScript = createPersistentPortableNsiScript(originalScript);
  if (patchedScript === originalScript) {
    return async () => {};
  }

  await fs.writeFile(templatePath, patchedScript, "utf-8");

  let restored = false;
  return async () => {
    if (restored) {
      return;
    }
    restored = true;
    await fs.writeFile(templatePath, originalScript, "utf-8");
  };
}

function createElectronBuilderCommand(builderCliPath, argv, options = {}) {
  return {
    args: [options.runnerPath || resolveElectronBuilderRunnerPath(), builderCliPath, ...argv],
    command: process.execPath,
    cwd: options.cwd || PROJECT_ROOT,
    env: process.env,
  };
}

function runElectronBuilder(builderCliPath, argv, options = {}) {
  return new Promise((resolve, reject) => {
    const command = createElectronBuilderCommand(builderCliPath, argv, options);
    const child = spawn(command.command, command.args, {
      cwd: command.cwd,
      env: command.env,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`electron-builder failed${signal ? ` with signal ${signal}` : ` with code ${code}`}`));
    });
  });
}

async function buildSelf(argv = process.argv.slice(2), options = {}) {
  const builderCliPath = options.builderCliPath || resolveLocalBuilderCliPath();
  await cleanupPreBuildOutputs(argv, options);
  const invocation = createBuildInvocation(argv, options);
  const restorePortableTemplate = shouldPatchPortableTemplate(argv, options.platform)
    ? await applyPersistentPortableTemplatePatch(builderCliPath)
    : async () => {};

  try {
    await runElectronBuilder(builderCliPath, invocation.argv, options);
    if (invocation.isolated) {
      await publishTopLevelExecutables(invocation.outputDir, invocation.finalOutputDir, options);
    }
  } finally {
    try {
      await restorePortableTemplate();
    } finally {
      if (invocation.isolated) {
        await removePathWithRetry(invocation.outputDir, {
          projectRoot: options.projectRoot || PROJECT_ROOT,
          allowedRoots: invocation.cleanupRoots,
          attempts: options.attempts,
          retryDelayMs: options.retryDelayMs,
        });
      }
    }
  }
}

if (require.main === module) {
  buildSelf().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}

module.exports = {
  applyPersistentPortableTemplatePatch,
  buildSelf,
  cleanupPreBuildOutputs,
  createBuildInvocation,
  createElectronBuilderCommand,
  createPersistentPortableNsiScript,
  getPreBuildCleanupTargets,
  publishTopLevelExecutables,
  resolveSelfBuildOutputRoot,
  resolvePortableTemplatePathFromBuilderCli,
  shouldPatchPortableTemplate,
};
