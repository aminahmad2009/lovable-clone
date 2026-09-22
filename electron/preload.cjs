/* Preload runs in an isolated world before the page loads. It exposes a tiny,
 * read-only bridge so the web UI can tell it is running inside the desktop
 * shell and hand external links to the OS browser. */

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktop', {
  isDesktop: true,
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
  },
  openExternal: (url) => ipcRenderer.send('open-external', url),
})
