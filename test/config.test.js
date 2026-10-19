const assert = require("node:assert/strict");
const test = require("node:test");
const { normalizeSettingsRecord, validateBuildForm } = require("../src/config");

const base = { projectDir: ".", targetWindows: true };

test("共享校验接受四段 Chromium、SemVer 预发布和构建标记", () => {
  assert.equal(validateBuildForm({ ...base, chromiumVersion: "152.0.7977.78", version: "1.0.0-beta.1+build.2", electronVersion: "44.3.0" }), "");
  for (const version of ["1.0", "01.0.0", "1.0.0-01", "1.0.0."]) assert.ok(validateBuildForm({ ...base, version }));
});

test("共享校验拒绝冲突架构、非法窗口尺寸和安装器配置", () => {
  for (const fields of [{ arches: "universal" }, { arches: "invalid" }, { windowWidth: "1280px" },
    { windowHeight: "99999999999" }, { nsisOneClick: true, nsisAllowChangeDir: true }]) {
    assert.ok(validateBuildForm({ ...base, ...fields }));
  }
  assert.throws(() => normalizeSettingsRecord({ targetWindows: "false" }), /布尔值/);
});
