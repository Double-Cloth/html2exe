(function (root) {
  "use strict";

  const booleanFields = new Set([
    "asar", "npmRebuild", "clearRuntimeOverridesAfterBuild", "targetWindows", "targetLinux", "targetMac",
    "winPortable", "nsisOneClick", "nsisPerMachine", "nsisAllowElevation", "nsisAllowChangeDir",
    "nsisDeleteAppData", "windowShowMenuBar", "windowFrame", "windowResizable", "windowFullscreenable", "windowAlwaysOnTop",
  ]);
  const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
  const parseArches = (raw) => String(raw || "").split(",").map((value) => value.trim()).filter(Boolean);

  function normalizeSettingsRecord(settings) {
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
      throw new Error("配置内容必须是 JSON 对象。");
    }
    const normalized = {};
    for (const [key, value] of Object.entries(settings)) {
      if (["__proto__", "prototype", "constructor"].includes(key)) throw new Error(`配置项“${key}”不受支持。`);
      if (booleanFields.has(key)) {
        if (typeof value !== "boolean") throw new Error(`配置项“${key}”必须是布尔值。`);
        normalized[key] = value;
      } else if (value === null || typeof value === "string" || (typeof value === "number" && Number.isFinite(value))) {
        normalized[key] = value === null ? "" : String(value);
      } else {
        throw new Error(`配置项“${key}”的值类型不受支持。`);
      }
    }
    return normalized;
  }

  function validateBuildForm(payload) {
    if (!payload.projectDir) return "请先选择要打包的项目目录。";
    if (!payload.targetWindows && !payload.targetLinux && !payload.targetMac) return "请至少选择一个目标平台。";
    if (payload.version && !semverPattern.test(payload.version)) return "应用版本号必须符合 SemVer，例如 1.0.0 或 1.0.0-beta.1。";
    for (const [key, label] of [["electronVersion", "Electron"], ["nodeVersion", "Node.js"]]) {
      if (payload[key] && !semverPattern.test(payload[key])) return `${label} 版本格式无效，请使用完整版本号，例如 44.3.0。`;
    }
    if (payload.chromiumVersion && !/^\d+\.\d+\.\d+\.\d+$/.test(payload.chromiumVersion)) {
      return "Chromium 版本格式无效，请使用四段版本号，例如 152.0.7977.78。";
    }
    const arches = parseArches(payload.arches);
    const invalid = arches.filter((arch) => !["x64", "arm64", "ia32", "armv7l", "universal"].includes(arch));
    if (invalid.length) return `架构参数无效: ${invalid.join(", ")}。`;
    if (arches.includes("universal") && (payload.targetWindows || payload.targetLinux)) return "universal 仅适用于 macOS。";
    if (payload.targetMac && arches.some((arch) => ["ia32", "armv7l"].includes(arch))) return "macOS 不支持 ia32 或 armv7l 架构。";
    if (payload.targetWindows && arches.includes("armv7l")) return "Windows 目标不支持 armv7l 架构。";
    for (const [key, label] of [["windowWidth", "窗口宽度"], ["windowHeight", "窗口高度"]]) {
      if (payload[key] && (!/^\d+$/.test(payload[key]) || Number(payload[key]) < 1 || Number(payload[key]) > 32767)) {
        return `${label}必须是 1 到 32767 之间的整数。`;
      }
    }
    if (payload.compression && !["store", "normal", "maximum"].includes(payload.compression)) return "压缩级别无效。";
    if (payload.nsisOneClick && payload.nsisAllowChangeDir) return "允许选择安装目录时，请先关闭单击安装。";
    return "";
  }

  const api = { normalizeSettingsRecord, validateBuildForm, parseArches };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.builderConfig = api;
})(typeof window === "object" ? window : globalThis);
