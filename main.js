const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const fs = require("fs/promises");
const path = require("path");
const { pathToFileURL } = require("url");

const IMAGE_FILE_PATTERN = /\.(avif|bmp|gif|jpe?g|png|webp)$/i;
const CUSTOM_DECK_PREFIX = "custom:";
const CUSTOM_DECKS_FOLDER = "custom-decks";
const CUSTOM_DECKS_FILE = "decks.json";

function pngBufferFromDataUrl(dataUrl) {
  const match = /^data:image\/png;base64,(.+)$/i.exec(String(dataUrl));
  if (!match) throw new Error("PNG invalido.");
  return Buffer.from(match[1], "base64");
}

async function listImageFiles(folderPath, rootPath = folderPath) {
  const entries = await fs.readdir(folderPath, { withFileTypes: true });
  const files = await Promise.all(entries.map(async entry => {
    const fullPath = path.join(folderPath, entry.name);
    if (entry.isDirectory()) return listImageFiles(fullPath, rootPath);
    if (!entry.isFile() || !IMAGE_FILE_PATTERN.test(entry.name)) return [];

    return [{
      name: entry.name,
      relativePath: path.relative(rootPath, fullPath).split(path.sep).join("/"),
      type: imageMimeType(entry.name)
    }];
  }));

  return files.flat().sort((a, b) => a.relativePath.localeCompare(b.relativePath, "es", {
    numeric: true,
    sensitivity: "base"
  }));
}

function imageMimeType(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".bmp") return "image/bmp";
  if (ext === ".avif") return "image/avif";
  return "image/jpeg";
}

function customDecksRoot() {
  return path.join(app.getPath("userData"), CUSTOM_DECKS_FOLDER);
}

function customDecksFile() {
  return path.join(customDecksRoot(), CUSTOM_DECKS_FILE);
}

function safeFolderName(name) {
  return String(name)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "baraja";
}

async function readDeckRecords() {
  try {
    const content = await fs.readFile(customDecksFile(), "utf8");
    const records = JSON.parse(content);
    return Array.isArray(records) ? records : [];
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function writeDeckRecords(records) {
  await fs.mkdir(customDecksRoot(), { recursive: true });
  await fs.writeFile(customDecksFile(), JSON.stringify(records, null, 2), "utf8");
}

function deckRecordForRenderer(record) {
  return {
    id: record.id,
    label: record.label,
    custom: true,
    desktop: true,
    urls: record.files.map(file => pathToFileURL(path.join(customDecksRoot(), record.folder, file)).href)
  };
}

async function importCustomDeckFromFolder(folderPath) {
  const imageFiles = await listImageFiles(folderPath);
  if (imageFiles.length < 54) {
    return {
      error: `La carpeta debe tener al menos 54 imagenes. Encontré ${imageFiles.length}.`
    };
  }

  const id = `${CUSTOM_DECK_PREFIX}${Date.now()}`;
  const label = path.basename(folderPath) || "Baraja nueva";
  const folder = `${Date.now()}-${safeFolderName(label)}`;
  const destination = path.join(customDecksRoot(), folder);
  await fs.mkdir(destination, { recursive: true });

  const copiedFiles = [];
  for (const [index, source] of imageFiles.slice(0, 54).entries()) {
    const ext = path.extname(source.name) || ".jpg";
    const fileName = `${String(index + 1).padStart(2, "0")}-${safeFolderName(path.basename(source.name, ext))}${ext.toLowerCase()}`;
    await fs.copyFile(path.join(folderPath, source.relativePath), path.join(destination, fileName));
    copiedFiles.push(fileName);
  }

  const record = {
    id,
    label,
    folder,
    createdAt: new Date().toISOString(),
    files: copiedFiles
  };

  const records = await readDeckRecords();
  records.push(record);
  records.sort((a, b) => a.label.localeCompare(b.label, "es", { numeric: true, sensitivity: "base" }));
  await writeDeckRecords(records);

  return { deck: deckRecordForRenderer(record) };
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 950,
    minWidth: 1100,
    minHeight: 760,
    backgroundColor: "#f8fafc",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false
    }
  });

  win.loadFile(path.join(__dirname, "index.html"));

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

ipcMain.handle("load-custom-decks", async () => {
  const records = await readDeckRecords();
  return records.map(deckRecordForRenderer);
});

ipcMain.handle("import-custom-deck", async () => {
  const result = await dialog.showOpenDialog({
    title: "Selecciona la carpeta de la baraja",
    properties: ["openDirectory"]
  });

  if (result.canceled || !result.filePaths[0]) {
    return { canceled: true };
  }

  return importCustomDeckFromFolder(result.filePaths[0]);
});

ipcMain.handle("delete-custom-deck", async (_event, id) => {
  const records = await readDeckRecords();
  const record = records.find(item => item.id === id);
  if (!record) return;

  await fs.rm(path.join(customDecksRoot(), record.folder), { recursive: true, force: true });
  await writeDeckRecords(records.filter(item => item.id !== id));
});

ipcMain.handle("save-png", async (_event, dataUrl, filename) => {
  const result = await dialog.showSaveDialog({
    title: "Guardar PNG",
    defaultPath: filename || "tablitas-pozito.png",
    filters: [{ name: "PNG", extensions: ["png"] }]
  });

  if (result.canceled || !result.filePath) return { canceled: true };
  await fs.writeFile(result.filePath, pngBufferFromDataUrl(dataUrl));
  return { filePath: result.filePath };
});

ipcMain.handle("choose-batch-directory", async () => {
  const result = await dialog.showOpenDialog({
    title: "Selecciona donde guardar los 20 PNGs",
    properties: ["openDirectory", "createDirectory"]
  });

  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  return { directoryPath: result.filePaths[0] };
});

ipcMain.handle("save-batch-png", async (_event, directoryPath, dataUrl, filename) => {
  if (!directoryPath) throw new Error("Carpeta invalida.");
  await fs.mkdir(directoryPath, { recursive: true });
  await fs.writeFile(path.join(directoryPath, filename), pngBufferFromDataUrl(dataUrl));
  return { filePath: path.join(directoryPath, filename) };
});

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
