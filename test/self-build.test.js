const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repoRoot = path.resolve(__dirname, "..");

test("npm build defaults to persistent Windows portable output", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf-8"));
  const lock = JSON.parse(fs.readFileSync(path.join(repoRoot, "package-lock.json"), "utf-8"));
  const indexHtml = fs.readFileSync(path.join(repoRoot, "src", "index.html"), "utf-8");

  assert.equal(pkg.version, "2.0.5");
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[""].version, pkg.version);
  assert.match(indexHtml, new RegExp(`>v${pkg.version.replaceAll(".", "\\.")}<`));
  assert.equal(pkg.scripts.prebuild, "node scripts/pack-toolchain.js");
  assert.equal(pkg.scripts.build, "node scripts/build-self.js");
  assert.equal(pkg.build.afterPack, "./scripts/afterPack.js");
  assert.equal(pkg.build.icon, "src/assets/images/icon.png");
  assert.equal(pkg.build.win.icon, "src/assets/images/icon.ico");
  assert.deepEqual(pkg.build.win.target, ["portable"]);
  assert.equal(pkg.build.portable.unpackDirName, "html2exe");
  assert.equal(pkg.build.portable.requestExecutionLevel, "user");
  assert.ok(pkg.build.files.includes("scripts/**/*"));
});

test("内置运行时版本候选与当前 Electron 稳定版本保持同步", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf-8"));
  const indexHtml = fs.readFileSync(path.join(repoRoot, "src", "index.html"), "utf-8");
  const mainSource = fs.readFileSync(path.join(repoRoot, "main.js"), "utf-8");

  assert.equal(pkg.devDependencies.electron, "^44.3.0");
  assert.match(mainSource, /return "44\.3\.0";/);
  ["44.3.0", "43.6.0", "42.11.3"].forEach((version) => {
    assert.match(indexHtml, new RegExp(`<option value="${version.replaceAll(".", "\\.")}"`));
  });
  ["152.0.7977.78", "150.0.7871.250", "148.0.7778.280"].forEach((version) => {
    assert.match(indexHtml, new RegExp(`<option value="${version.replaceAll(".", "\\.")}"`));
  });
  ["26.8.1", "24.21.0", "24.20.0"].forEach((version) => {
    assert.match(indexHtml, new RegExp(`<option value="${version.replaceAll(".", "\\.")}"`));
  });
});

test("self build wrapper patches portable template for Windows builds", () => {
  const selfBuild = require("../scripts/build-self");
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
    "\tRMDir /r $INSTDIR",
    "SectionEnd",
  ].join("\n");

  assert.equal(selfBuild.shouldPatchPortableTemplate([], "win32"), true);
  assert.equal(selfBuild.shouldPatchPortableTemplate(["--linux"], "win32"), false);
  assert.equal(selfBuild.shouldPatchPortableTemplate(["--win"], "linux"), true);

  const patched = selfBuild.createPersistentPortableNsiScript(template);
  assert.match(patched, /LoadLanguageFile "\$\{NSISDIR\}\\Contrib\\Language files\\English\.nlf"/);
  assert.match(patched, /ShowInstDetails show/);
  assert.match(patched, /Page instfiles/);
  assert.doesNotMatch(patched, /SetSilent silent/);
  assert.match(patched, /\$EXEDIR\\\$\{UNPACK_DIR_NAME\}/);
  assert.doesNotMatch(patched, /ExecWait "\$INSTDIR\\\$\{APP_EXECUTABLE_FILENAME\}/);
  assert.doesNotMatch(patched, /SetErrorLevel \$0/);
  assert.match(patched, /RMDir \/r "\$PLUGINSDIR"/);
  assert.match(patched, /SHChangeNotify\(i 0x08000000/);
  assert.match(patched, /MessageBox MB_OK "Extraction complete\."/);
  assert.doesNotMatch(patched, /[\u4e00-\u9fff]/);
  assert.doesNotMatch(patched.slice(patched.indexOf(" SetOutPath $EXEDIR")), /[ \t]+RMDir \/r \$INSTDIR/);
});

test("self build cleans stale Windows staging directories before packaging", () => {
  const selfBuild = require("../scripts/build-self");
  const root = path.join("D:", "repo");

  assert.deepEqual(selfBuild.getPreBuildCleanupTargets([], "win32", root), [
    path.join(root, "dist", "win-unpacked"),
    path.join(root, "dist", "win-unpacked.tmp"),
  ]);
  assert.deepEqual(selfBuild.getPreBuildCleanupTargets(["--win"], "linux", root), [
    path.join(root, "dist", "win-unpacked"),
    path.join(root, "dist", "win-unpacked.tmp"),
  ]);
  assert.deepEqual(selfBuild.getPreBuildCleanupTargets(["--linux"], "win32", root), []);
});

test("self build isolates Windows output before publishing artifacts", () => {
  const selfBuild = require("../scripts/build-self");
  const root = path.join("D:", "repo");
  const selfBuildOutputRoot = path.join("D:", "temp", "html2exe-self-build");
  const plan = selfBuild.createBuildInvocation(["--x64"], {
    platform: "win32",
    projectRoot: root,
    buildId: "build-test",
    selfBuildOutputRoot,
  });

  assert.equal(plan.isolated, true);
  assert.equal(plan.outputDir, path.join(selfBuildOutputRoot, "build-test"));
  assert.equal(plan.finalOutputDir, path.join(root, "dist"));
  assert.deepEqual(plan.argv, ["--x64", `-c.directories.output=${plan.outputDir}`]);
  assert.equal(
    selfBuild.createBuildInvocation(["--linux"], {
      platform: "win32",
      projectRoot: root,
      buildId: "build-test",
    }).isolated,
    false
  );
  assert.equal(
    selfBuild.createBuildInvocation(["-c.directories.output=custom"], {
      platform: "win32",
      projectRoot: root,
      buildId: "build-test",
    }).isolated,
    false
  );
});

test("self build runs electron-builder through rename retry runner", () => {
  const selfBuild = require("../scripts/build-self");
  const command = selfBuild.createElectronBuilderCommand("C:\\tools\\electron-builder\\cli.js", ["--win"], {
    cwd: "D:\\repo",
    runnerPath: "D:\\repo\\scripts\\electron-builder-runner.js",
  });

  assert.equal(command.command, process.execPath);
  assert.equal(command.cwd, "D:\\repo");
  assert.deepEqual(command.args, [
    "D:\\repo\\scripts\\electron-builder-runner.js",
    "C:\\tools\\electron-builder\\cli.js",
    "--win",
  ]);
});
