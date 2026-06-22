const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("pozitoDecks", {
  loadCustomDecks: () => ipcRenderer.invoke("load-custom-decks"),
  importCustomDeck: () => ipcRenderer.invoke("import-custom-deck"),
  deleteCustomDeck: id => ipcRenderer.invoke("delete-custom-deck", id),
  savePng: (dataUrl, filename) => ipcRenderer.invoke("save-png", dataUrl, filename),
  chooseBatchDirectory: () => ipcRenderer.invoke("choose-batch-directory"),
  saveBatchPng: (directoryPath, dataUrl, filename) => ipcRenderer.invoke("save-batch-png", directoryPath, dataUrl, filename)
});
