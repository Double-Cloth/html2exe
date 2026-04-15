const formFieldIds = [
  "projectDir",
  "outputDir",
  "appId",
  "productName",
  "executableName",
  "artifactName",
  "version",
  "author",
  "description",
  "compression",
  "arches",
  "asar",
  "npmRebuild",
  "targetWindows",
  "targetLinux",
  "targetMac",
  "winTargets",
  "winPortable",
  "linuxTargets",
  "macTargets",
  "publisherName",
  "linuxCategory",
  "macCategory",
  "nsisOneClick",
  "nsisPerMachine",
  "nsisAllowElevation",
  "nsisAllowChangeDir",
  "nsisShortcutName",
  "nsisCreateDesktopShortcut",
  "nsisDeleteAppData",
  "winIcon",
  "linuxIcon",
  "macIcon",
  "filesGlobs",
  "extraResources",
  "asarUnpack",
  "windowTitle",
  "windowWidth",
  "windowHeight",
  "windowShowMenuBar",
  "windowFrame",
  "windowResizable",
  "windowFullscreenable",
  "windowAlwaysOnTop",
];

const dom = {
  buildBtn: document.getElementById("buildBtn"),
  cancelBuildBtn: document.getElementById("cancelBuildBtn"),
  saveConfigBtn: document.getElementById("saveConfigBtn"),
  clearCacheBtn: document.getElementById("clearCacheBtn"),
  loadProjectDefaultsBtn: document.getElementById("loadProjectDefaultsBtn"),
  clearLogBtn: document.getElementById("clearLogBtn"),
  pickProjectBtn: document.getElementById("pickProjectBtn"),
  pickOutputBtn: document.getElementById("pickOutputBtn"),
  pickWinIconBtn: document.getElementById("pickWinIconBtn"),
  pickLinuxIconBtn: document.getElementById("pickLinuxIconBtn"),
  pickMacIconBtn: document.getElementById("pickMacIconBtn"),
  logOutput: document.getElementById("logOutput"),
  overallStatus: document.getElementById("overallStatus"),
  buildSteps: document.getElementById("buildSteps"),
  actionFeedback: document.getElementById("actionFeedback"),
};

let isBuilding = false;
let actionFeedbackTimer = null;

const stepDefaults = {
  prepare: "等待开始",
  "temp-project": "按需执行",
  install: "等待开始",
  package: "等待开始",
  artifact: "等待开始",
  complete: "等待开始",
};

function setActionFeedback(text, level = "pending", autoClearMs = 0) {
  if (!dom.actionFeedback) {
    return;
  }

  if (actionFeedbackTimer) {
    clearTimeout(actionFeedbackTimer);
    actionFeedbackTimer = null;
  }

  dom.actionFeedback.classList.remove("pending", "success", "error");
  if (["pending", "success", "error"].includes(level)) {
    dom.actionFeedback.classList.add(level);
  }
  dom.actionFeedback.textContent = text;

  if (autoClearMs > 0) {
    actionFeedbackTimer = setTimeout(() => {
      dom.actionFeedback.classList.remove("pending", "success", "error");
      dom.actionFeedback.textContent = "等待操作...";
      actionFeedbackTimer = null;
    }, autoClearMs);
  }
}

function setButtonBusy(button, busy, busyText, idleText) {
  if (!button) {
    return;
  }
  if (!button.dataset.idleText) {
    button.dataset.idleText = idleText || button.textContent;
  }
  if (busy) {
    button.classList.add("is-busy");
    button.disabled = true;
    button.textContent = busyText;
    return;
  }

  button.classList.remove("is-busy");
  button.disabled = false;
  button.textContent = button.dataset.idleText;
}

function appendLog(line, kind = "normal") {
  const stamp = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  if (dom.logOutput.textContent === "等待开始...") {
    dom.logOutput.textContent = "";
  }
  dom.logOutput.textContent += `[${stamp}] ${line}`;
  if (!line.endsWith("\n")) {
    dom.logOutput.textContent += "\n";
  }

  if (kind === "error") {
    dom.logOutput.classList.add("status-error");
    dom.logOutput.classList.remove("status-ok");
  }
  if (kind === "ok") {
    dom.logOutput.classList.add("status-ok");
    dom.logOutput.classList.remove("status-error");
  }

  dom.logOutput.scrollTop = dom.logOutput.scrollHeight;
}

function setOverallStatus(state, text) {
  if (!dom.overallStatus) {
    return;
  }
  dom.overallStatus.className = `overall-status ${state}`;
  dom.overallStatus.textContent = text;
}

function resetProgressView() {
  setOverallStatus("idle", "待命");
  if (!dom.buildSteps) {
    return;
  }
  dom.buildSteps.querySelectorAll(".step-item").forEach((item) => {
    item.classList.remove("running", "done", "failed");
    const stepKey = item.dataset.step;
    const detail = item.querySelector(".detail");
    if (detail) {
      detail.textContent = stepDefaults[stepKey] || "等待开始";
    }
  });
}

function updateStepView(step, state, text) {
  if (!dom.buildSteps) {
    return;
  }
  const row = dom.buildSteps.querySelector(`.step-item[data-step="${step}"]`);
  if (!row) {
    return;
  }

  row.classList.remove("running", "done", "failed");
  if (state === "running") {
    row.classList.add("running");
  } else if (state === "done") {
    row.classList.add("done");
  } else if (state === "failed") {
    row.classList.add("failed");
  }

  const detail = row.querySelector(".detail");
  if (detail && text) {
    detail.textContent = text;
  }
}

function applyStatusPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return;
  }

  if (payload.type === "overall") {
    const map = {
      running: "构建进行中",
      success: "构建成功",
      failed: "构建失败",
      canceled: "构建已取消",
      idle: "待命",
    };
    setOverallStatus(payload.state || "idle", payload.text || map[payload.state] || "待命");
    return;
  }

  if (payload.type === "step") {
    updateStepView(payload.step, payload.state, payload.text);
  }
}

function gatherFormState() {
  const payload = {};
  for (const id of formFieldIds) {
    const el = document.getElementById(id);
    if (!el) {
      continue;
    }
    if (el.type === "checkbox") {
      payload[id] = el.checked;
    } else {
      payload[id] = el.value.trim();
    }
  }
  return payload;
}

function applyStateToForm(state) {
  if (!state || typeof state !== "object") {
    return;
  }
  for (const id of formFieldIds) {
    const el = document.getElementById(id);
    if (!el || !(id in state)) {
      continue;
    }
    if (el.type === "checkbox") {
      el.checked = Boolean(state[id]);
    } else {
      el.value = state[id] ?? "";
    }
  }
}

function applyDefaultsToForm(defaults) {
  if (!defaults || typeof defaults !== "object") {
    return;
  }

  Object.entries(defaults).forEach(([key, value]) => {
    if (!formFieldIds.includes(key)) {
      return;
    }
    const el = document.getElementById(key);
    if (!el) {
      return;
    }

    if (el.type === "checkbox") {
      if (typeof value === "boolean") {
        el.checked = value;
      }
      return;
    }

    const current = el.value.trim();
    if (!current && value) {
      el.value = String(value);
    }
  });
}

function isSemverLike(version) {
  if (!version) {
    return true;
  }
  return /^\d+\.\d+\.\d+([-.][0-9A-Za-z.]+)?$/.test(version);
}

function getInvalidArches(raw) {
  if (!raw) {
    return [];
  }
  const allowed = new Set(["x64", "arm64", "ia32", "armv7l", "universal"]);
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => !allowed.has(item));
}

function isPositiveIntLike(raw) {
  if (!raw) {
    return true;
  }
  return /^\d+$/.test(raw) && Number.parseInt(raw, 10) > 0;
}

function validateBeforeBuild(payload) {
  if (!payload.projectDir) {
    return "请先选择要打包的项目目录。";
  }
  if (!payload.targetWindows && !payload.targetLinux && !payload.targetMac) {
    return "请至少选择一个目标平台。";
  }
  if (!isSemverLike(payload.version)) {
    return "版本号格式建议为 x.y.z，例如 1.0.0。";
  }
  const invalidArches = getInvalidArches(payload.arches);
  if (invalidArches.length > 0) {
    return `架构参数无效: ${invalidArches.join(", ")}。可选 x64, arm64, ia32, armv7l, universal。`;
  }
  if (!isPositiveIntLike(payload.windowWidth)) {
    return "窗口宽度必须是正整数，例如 1280。";
  }
  if (!isPositiveIntLike(payload.windowHeight)) {
    return "窗口高度必须是正整数，例如 800。";
  }
  return "";
}

function updateBuildState(next) {
  isBuilding = next;
  dom.cancelBuildBtn.disabled = !next;
  dom.buildBtn.disabled = next;
}

function setFormBusy(busy) {
  formFieldIds.forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.disabled = busy;
    }
  });
  dom.loadProjectDefaultsBtn.disabled = busy;
  dom.pickProjectBtn.disabled = busy;
  dom.pickOutputBtn.disabled = busy;
  dom.pickWinIconBtn.disabled = busy;
  dom.pickLinuxIconBtn.disabled = busy;
  dom.pickMacIconBtn.disabled = busy;
  dom.saveConfigBtn.disabled = busy;
  dom.clearCacheBtn.disabled = busy;
  updateBuildState(busy);
}

async function pickDirectory(targetInputId, picker) {
  const dir = await picker();
  if (!dir) {
    return;
  }
  const input = document.getElementById(targetInputId);
  input.value = dir;
}

async function loadProjectDefaults() {
  const projectDir = document.getElementById("projectDir").value.trim();
  if (!projectDir) {
    setActionFeedback("读取项目信息前，请先选择项目目录。", "error", 2200);
    appendLog("请先选择项目目录，再读取项目信息。", "error");
    return;
  }

  setButtonBusy(dom.loadProjectDefaultsBtn, true, "读取中...", "读取项目信息");
  setActionFeedback("正在读取目标项目默认配置...", "pending");
  try {
    const result = await window.builderApi.inspectProject(projectDir);
    if (!result?.success) {
      setActionFeedback(result?.error || "读取项目信息失败。", "error", 2600);
      appendLog(result?.error || "读取项目配置失败。", "error");
      return;
    }

    applyDefaultsToForm(result.defaults);
    if (result.mode === "html-only") {
      setActionFeedback("已识别为纯 HTML 项目，将自动补全 Electron 打包结构。", "success", 2600);
      appendLog(
        `目录中检测到 HTML 入口 (${result.htmlEntry})，将按纯 HTML 自动补全方式打包。`,
        "ok"
      );
    } else {
      setActionFeedback("项目默认配置已读取并填充。", "success", 2200);
      appendLog("已按项目 package.json / build 自动填充空白字段。", "ok");
    }
  } finally {
    setButtonBusy(dom.loadProjectDefaultsBtn, false);
  }
}

async function pickIcon(targetInputId, allowedExt) {
  const icon = await window.builderApi.pickIconFile(allowedExt);
  if (!icon) {
    return;
  }
  document.getElementById(targetInputId).value = icon;
}

async function saveConfig() {
  const payload = gatherFormState();
  setButtonBusy(dom.saveConfigBtn, true, "保存中...", "保存配置");
  setActionFeedback("正在保存配置...", "pending");
  try {
    await window.builderApi.saveSettings(payload);
    setActionFeedback("配置已保存。", "success", 1800);
    appendLog("配置已保存。", "ok");
  } finally {
    setButtonBusy(dom.saveConfigBtn, false);
  }
}

async function runBuild() {
  if (isBuilding) {
    setActionFeedback("已有打包任务在运行，请稍后或先取消。", "error", 2200);
    appendLog("已有任务在运行，请先取消或等待完成。", "error");
    return;
  }

  const payload = gatherFormState();
  const invalidMessage = validateBeforeBuild(payload);
  if (invalidMessage) {
    setActionFeedback(invalidMessage, "error", 2800);
    appendLog(invalidMessage, "error");
    return;
  }

  setActionFeedback("已开始打包，请关注下方构建进度与日志。", "pending");
  setButtonBusy(dom.buildBtn, true, "打包中...", "开始打包");
  appendLog("准备开始打包...\n");
  resetProgressView();
  setOverallStatus("running", "构建进行中");
  setFormBusy(true);
  try {
    const saveResult = await window.builderApi.saveSettings(payload);
    if (!saveResult?.success) {
      appendLog("保存配置失败，仍继续尝试打包。", "error");
    }

    const result = await window.builderApi.runBuild(payload);
    if (result?.success && result?.result?.success) {
      const sec = Math.round((result.result.durationMs || 0) / 1000);
      setActionFeedback(`打包完成，用时 ${sec} 秒。`, "success", 3200);
      appendLog(`打包完成，用时 ${sec} 秒。`, "ok");
      setOverallStatus("success", "构建成功");
    } else if (result?.result?.canceled) {
      setActionFeedback("打包已取消。", "error", 2800);
      appendLog("打包已取消。", "error");
      setOverallStatus("canceled", "构建已取消");
    } else {
      setActionFeedback(result?.error || "打包失败。", "error", 3200);
      appendLog(result?.error || "打包失败。", "error");
      setOverallStatus("failed", "构建失败");
    }
  } catch (error) {
    setActionFeedback(`打包异常: ${error.message}`, "error", 3200);
    appendLog(`打包异常: ${error.message}`, "error");
    setOverallStatus("failed", "构建失败");
  } finally {
    setButtonBusy(dom.buildBtn, false);
    setFormBusy(false);
  }
}

async function cancelBuild() {
  if (!isBuilding) {
    setActionFeedback("当前没有正在运行的打包任务。", "error", 2200);
    appendLog("当前没有正在运行的打包任务。", "error");
    return;
  }

  setButtonBusy(dom.cancelBuildBtn, true, "取消中...", "取消打包");
  setActionFeedback("正在发送取消请求...", "pending");
  try {
    const result = await window.builderApi.cancelBuild();
    if (result?.success) {
      setActionFeedback("已发送取消请求，等待进程退出。", "pending", 2400);
      appendLog("已发送取消请求，等待进程退出。", "error");
    } else {
      setActionFeedback(result?.error || "取消失败。", "error", 2600);
      appendLog(result?.error || "取消失败。", "error");
    }
  } finally {
    setButtonBusy(dom.cancelBuildBtn, false);
  }
}

async function clearCache() {
  setButtonBusy(dom.clearCacheBtn, true, "清理中...", "清理缓存");
  setActionFeedback("正在清理本地缓存目录...", "pending");
  try {
    const result = await window.builderApi.clearCache();
    if (result?.success) {
      const skippedList = Array.isArray(result.skipped) ? result.skipped : [];
      const autoRecovered = Number(result.autoRecovered || 0);
      const killedProcesses = Number(result.killedProcesses || 0);
      if (skippedList.length > 0) {
        setActionFeedback("缓存已部分清理，少量文件仍被占用。", "error", 3200);
        appendLog(
          `缓存部分清理，目录: ${result.cacheRoot}，已重置目录数: ${result.removed}，自动解占用恢复: ${autoRecovered}，终止进程: ${killedProcesses}，跳过: ${skippedList.length}`,
          "error"
        );
        skippedList.slice(0, 5).forEach((item) => {
          appendLog(
            `跳过占用项: ${item.path} (${item.code || "EBUSY"})`,
            "error"
          );
        });
      } else {
        setActionFeedback("缓存清理完成。", "success", 2200);
        appendLog(
          `缓存已清理，目录: ${result.cacheRoot}，已重置目录数: ${result.removed}，自动解占用恢复: ${autoRecovered}，终止进程: ${killedProcesses}`,
          "ok"
        );
      }

      const unlockedBy = Array.isArray(result.unlockedBy) ? result.unlockedBy : [];
      unlockedBy.slice(0, 5).forEach((proc) => {
        appendLog(
          `已结束占用进程: ${proc.name || "unknown"} (PID ${proc.pid || "?"})`,
          "ok"
        );
      });
    } else {
      setActionFeedback(result?.error || "清理缓存失败。", "error", 2600);
      appendLog(result?.error || "清理缓存失败。", "error");
    }
  } finally {
    setButtonBusy(dom.clearCacheBtn, false);
  }
}

async function init() {
  const saved = await window.builderApi.loadSettings();
  applyStateToForm(saved);
  resetProgressView();
  setActionFeedback("准备就绪。", "success", 1500);

  window.builderApi.onLog((line) => {
    appendLog(line);
  });

  window.builderApi.onStatus((payload) => {
    applyStatusPayload(payload);
  });

  dom.pickProjectBtn.addEventListener("click", () => {
    pickDirectory("projectDir", window.builderApi.pickProjectDir).then(() => {
      loadProjectDefaults().catch((error) => {
        appendLog(`读取项目信息失败: ${error.message}`, "error");
      });
    });
  });

  dom.pickOutputBtn.addEventListener("click", () => {
    pickDirectory("outputDir", window.builderApi.pickOutputDir);
  });

  dom.pickWinIconBtn.addEventListener("click", () => {
    pickIcon("winIcon", ["ico", "png"]);
  });

  dom.pickLinuxIconBtn.addEventListener("click", () => {
    pickIcon("linuxIcon", ["png", "svg"]);
  });

  dom.pickMacIconBtn.addEventListener("click", () => {
    pickIcon("macIcon", ["icns", "png"]);
  });

  dom.saveConfigBtn.addEventListener("click", async () => {
    try {
      await saveConfig();
    } catch (error) {
      appendLog(`保存失败: ${error.message}`, "error");
    }
  });

  dom.loadProjectDefaultsBtn.addEventListener("click", async () => {
    try {
      await loadProjectDefaults();
    } catch (error) {
      appendLog(`读取项目信息失败: ${error.message}`, "error");
    }
  });

  dom.clearCacheBtn.addEventListener("click", () => {
    clearCache().catch((error) => {
      appendLog(`清理缓存失败: ${error.message}`, "error");
    });
  });

  dom.buildBtn.addEventListener("click", runBuild);
  dom.cancelBuildBtn.addEventListener("click", () => {
    cancelBuild().catch((error) => {
      appendLog(`取消失败: ${error.message}`, "error");
    });
  });

  dom.clearLogBtn.addEventListener("click", () => {
    dom.logOutput.textContent = "等待开始...";
    dom.logOutput.classList.remove("status-error", "status-ok");
    resetProgressView();
    setActionFeedback("日志已清空。", "success", 1400);
  });
}

init().catch((error) => {
  appendLog(`初始化失败: ${error.message}`, "error");
});


// Tab switching logic
function initTabs() {
  const navItems = document.querySelectorAll('.nav-item');
  const tabContents = document.querySelectorAll('.tab-content');

  navItems.forEach(btn => {
    btn.addEventListener('click', () => {
      // Remove active from all
      navItems.forEach(b => b.classList.remove('active'));
      tabContents.forEach(t => t.classList.remove('active'));

      // Add active to clicked
      btn.classList.add('active');
      const tabId = 'tab-' + btn.dataset.tab;
      const tabEl = document.getElementById(tabId);
      if (tabEl) {
        tabEl.classList.add('active');
      }
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initTabs();
});
