const fs = require("node:fs");
const path = require("node:path");

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
    "$1$2System::Call 'shell32.dll::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'\n$2RMDir /r \"$$PLUGINSDIR\"\n$2MessageBox MB_OK \"Extraction complete.\"\n$2; persistent portable mode keeps unpacked files beside the executable."
  );
}


function resolvePortableTemplatePathFromBuilderCli(builderCliPath) {
  try {
    const manifest = require.resolve("app-builder-lib/package.json", { paths: [path.dirname(builderCliPath)] });
    const template = path.join(path.dirname(manifest), "templates", "nsis", "portable.nsi");
    return fs.existsSync(template) ? template : "";
  } catch (error) { return ""; }
}

function validatePortableTemplate(builderCliPath) {
  const templatePath = resolvePortableTemplatePathFromBuilderCli(builderCliPath);
  if (!templatePath) throw new Error("无法定位 electron-builder portable.nsi 模板，不能生成持久化绿色版。");
  return { templatePath, script: createPersistentPortableNsiScript(fs.readFileSync(templatePath, "utf8")) };
}

function installPortableTemplateOverride(builderCliPath) {
  const { templatePath, script } = validatePortableTemplate(builderCliPath);
  const library = require.resolve("app-builder-lib/package.json", { paths: [path.dirname(builderCliPath)] });
  const builderFs = require(require.resolve("fs-extra", { paths: [path.dirname(library)] }));
  const originalReadFile = builderFs.readFile;
  // 仅替换当前构建子进程读取的 portable 模板，不改写共享依赖文件。
  builderFs.readFile = function (file, ...args) {
    if (typeof file !== "string" || path.resolve(file) !== templatePath) return originalReadFile.call(this, file, ...args);
    const encoding = typeof args[0] === "string" ? args[0] : args[0]?.encoding;
    const value = encoding ? script : Buffer.from(script);
    const callback = args.find((arg) => typeof arg === "function");
    if (callback) { queueMicrotask(() => callback(null, value)); return; }
    return Promise.resolve(value);
  };
  return () => { builderFs.readFile = originalReadFile; };
}

module.exports = { createPersistentPortableNsiScript, resolvePortableTemplatePathFromBuilderCli, validatePortableTemplate, installPortableTemplateOverride };
