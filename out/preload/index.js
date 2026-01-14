"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("electronAPI", {
  ping: () => electron.ipcRenderer.invoke("ping")
});
