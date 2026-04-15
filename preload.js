const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("builderApi", {
  pickProjectDir: () => ipcRenderer.invoke("dialog:pickProject"),
  pickOutputDir: () => ipcRenderer.invoke("dialog:pickOutput"),
  pickIconFile: (extensions) => ipcRenderer.invoke("dialog:pickIcon", extensions),
  loadSettings: () => ipcRenderer.invoke("settings:load"),
  saveSettings: (payload) => ipcRenderer.invoke("settings:save", payload),
  inspectProject: (projectDir) => ipcRenderer.invoke("project:inspect", projectDir),
  runBuild: (payload) => ipcRenderer.invoke("builder:run", payload),
  cancelBuild: () => ipcRenderer.invoke("builder:cancel"),
  clearCache: () => ipcRenderer.invoke("cache:clear"),
  onLog: (callback) => {
    const listener = (_, line) => callback(line);
    ipcRenderer.on("builder:log", listener);
    return () => ipcRenderer.removeListener("builder:log", listener);
  },
  onStatus: (callback) => {
    const listener = (_, payload) => callback(payload);
    ipcRenderer.on("builder:status", listener);
    return () => ipcRenderer.removeListener("builder:status", listener);
  },
});
