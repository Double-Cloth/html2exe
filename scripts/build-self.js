const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const fssync = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createPersistentPortableNsiScript, resolvePortableTemplatePathFromBuilderCli, validatePortableTemplate } = require("./portable-template");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function resolveLocalBuilderCliPath() {
  return require.resolve("electron-builder/cli.js", { paths: [PROJECT_ROOT] });
}

function resolveElectronBuilderRunnerPath() {
  return path.join(__dirname, "electron-builder-runner.js");
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
      ["--config", "-c", "--config.directories.output", "-c.directories.output"].includes(value) ||
      value.startsWith("--config=") || value.startsWith("-c=") ||
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
  const hasOtherPlatform = argv.some((arg) => /^--(?:linux|mac|macos)(?:=|$)/i.test(arg));
  const directoryOnly = argv.some((arg) => arg === "--dir" || arg === "dir");
  const isolated = shouldPatchPortableTemplate(argv, platform) && !hasOutputOverride(argv) && !hasOtherPlatform && !directoryOnly;

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
  return Boolean(relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function assertInsideAllowedRoots(targetPath, roots) {
  const resolvedTarget = path.resolve(targetPath);
  if (!roots.some((rootPath) => isPathInsideAllowedRoot(resolvedTarget, rootPath))) {
    throw new Error(`拒绝清理允许目录外的路径: ${resolvedTarget}`);
  }
}

async function resolvePhysicalPath(targetPath) {
  try { return await fs.realpath(targetPath); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    const parent = path.dirname(targetPath);
    if (parent === targetPath) throw error;
    return path.join(await resolvePhysicalPath(parent), path.basename(targetPath));
  }
}

async function removePathWithRetry(targetPath, options = {}) {
  const roots = [
    options.projectRoot || PROJECT_ROOT,
    ...(options.allowedRoots || []),
  ];
  assertInsideAllowedRoots(targetPath, roots);
  const physicalTarget = await resolvePhysicalPath(path.resolve(targetPath));
  const physicalRoots = await Promise.all(roots.map((root) => resolvePhysicalPath(path.resolve(root))));
  assertInsideAllowedRoots(physicalTarget, physicalRoots);

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
    (entry) => entry.isFile() && !/^builder-(?:debug|effective-config)\./i.test(entry.name)
  );

  if (executables.length === 0) {
    throw new Error(`构建已完成，但未在临时输出目录找到可发布的产物: ${outputDir}`);
  }

  for (const entry of executables) {
    const from = path.join(outputDir, entry.name);
    const to = path.join(finalOutputDir, entry.name);
    try {
      const stagedPath = `${to}.html2exe-${process.pid}.tmp`;
      try {
        await fs.copyFile(from, stagedPath);
        await fs.rename(stagedPath, to);
      } finally {
        await fs.rm(stagedPath, { force: true }).catch(() => {});
      }
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
  validatePortableTemplate(builderCliPath);
  return async () => {};
}

function createElectronBuilderCommand(builderCliPath, argv, options = {}) {
  return {
    args: [options.runnerPath || resolveElectronBuilderRunnerPath(), builderCliPath, ...argv],
    command: process.execPath,
    cwd: options.cwd || PROJECT_ROOT,
    env: { ...process.env, HTML2EXE_PERSISTENT_PORTABLE: shouldPatchPortableTemplate(argv, options.platform) ? "1" : "0" },
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

  let keepOutput = false;
  try {
    await runElectronBuilder(builderCliPath, invocation.argv, options);
    if (invocation.isolated) {
      keepOutput = true;
      await publishTopLevelExecutables(invocation.outputDir, invocation.finalOutputDir, options);
      keepOutput = false;
    }
  } finally {
    try {
      await restorePortableTemplate();
    } finally {
      if (invocation.isolated && !keepOutput) {
        await removePathWithRetry(invocation.outputDir, {
          projectRoot: options.projectRoot || PROJECT_ROOT,
          allowedRoots: invocation.cleanupRoots,
          attempts: options.attempts,
          retryDelayMs: options.retryDelayMs,
        });
      } else if (keepOutput) {
        console.error(`发布失败，构建产物已保留在: ${invocation.outputDir}`);
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
