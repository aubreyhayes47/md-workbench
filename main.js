const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const { fileURLToPath } = require("node:url");

let mainWindow = null;
let pendingOpenPayload = null;
let pendingOpenError = null;
let watchedFilePath = null;
let watchedFileWatcher = null;
let watchedFileDebounce = null;

function isMarkdownFile(p) {
  if (typeof p !== "string") return false;
  const lower = p.toLowerCase();
  return lower.endsWith(".md") || lower.endsWith(".markdown");
}

function normalizeArgToPath(arg) {
  if (typeof arg !== "string" || !arg) return null;
  if (arg.startsWith("file://")) {
    try {
      return fileURLToPath(arg);
    } catch {
      return null;
    }
  }
  return arg;
}

function extractMarkdownPath(argv) {
  if (!Array.isArray(argv)) return null;
  for (const raw of argv) {
    const p = normalizeArgToPath(raw);
    if (p && isMarkdownFile(p)) return p;
  }
  return null;
}

async function readTextFile(filePath) {
  const content = await fs.readFile(filePath, "utf8");
  return content;
}

async function writeTextFile(filePath, content) {
  await fs.writeFile(filePath, content, "utf8");
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    title: "md-workbench",
    webPreferences: {
      // Minimal stack: allow renderer to use require() for marked/dompurify.
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "index.html"));

  mainWindow.webContents.on("did-finish-load", () => {
    if (pendingOpenPayload) {
      mainWindow.webContents.send("open-file", pendingOpenPayload);
      pendingOpenPayload = null;
    }
    if (pendingOpenError) {
      mainWindow.webContents.send("open-file-error", pendingOpenError);
      pendingOpenError = null;
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function stopWatchingFile() {
  if (watchedFileDebounce) clearTimeout(watchedFileDebounce);
  watchedFileDebounce = null;
  if (watchedFileWatcher) {
    try {
      watchedFileWatcher.close();
    } catch {
      // ignore
    }
  }
  watchedFileWatcher = null;
  watchedFilePath = null;
}

function startWatchingFile(filePath) {
  stopWatchingFile();
  if (!filePath) return;

  watchedFilePath = filePath;
  try {
    watchedFileWatcher = fsSync.watch(filePath, { persistent: false }, (eventType) => {
      // fs.watch is noisy and can fire multiple times per write; debounce.
      if (watchedFileDebounce) clearTimeout(watchedFileDebounce);
      watchedFileDebounce = setTimeout(() => {
        if (!mainWindow) return;
        if (!watchedFilePath || watchedFilePath !== filePath) return;
        mainWindow.webContents.send("disk-file-changed", {
          filePath,
          eventType: eventType || "change",
          at: Date.now()
        });

        // If the file was atomically replaced, the watch can go stale; best-effort restart.
        if (eventType === "rename" && watchedFilePath === filePath) {
          setTimeout(() => {
            if (watchedFilePath === filePath) startWatchingFile(filePath);
          }, 500);
        }
      }, 250);
    });
  } catch {
    // File might not exist yet, or OS rejected the watch. Renderer can still reload manually.
    watchedFileWatcher = null;
  }
}

async function openMarkdownPath(filePath) {
  if (!filePath) return false;
  try {
    const content = await readTextFile(filePath);
    const payload = { filePath, content };
    if (!mainWindow) {
      pendingOpenPayload = payload;
      return true;
    }
    if (mainWindow.webContents.isLoading()) {
      pendingOpenPayload = payload;
      return true;
    }
    mainWindow.webContents.send("open-file", payload);
    return true;
  } catch (err) {
    const code = err && typeof err === "object" ? err.code : null;
    const message = err && typeof err === "object" ? err.message : String(err || "");
    const errorPayload = { filePath, code: code || "open_failed", message: message || "Open failed" };

    if (!mainWindow) {
      pendingOpenError = errorPayload;
      return false;
    }
    if (mainWindow.webContents.isLoading()) {
      pendingOpenError = errorPayload;
      return false;
    }
    mainWindow.webContents.send("open-file-error", errorPayload);
    return false;
  }
}

async function openFromArgv(argv) {
  const argPath = extractMarkdownPath(argv);
  if (!argPath) return false;
  return await openMarkdownPath(argPath);
}

// Ensure file-open requests go to a single instance.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", async (_event, argv) => {
    await app.whenReady();
    if (!mainWindow) createWindow();
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    await openFromArgv(argv);
  });
}

app.whenReady().then(async () => {
  createWindow();
  await openFromArgv(process.argv);

  app.on("activate", function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", function () {
  stopWatchingFile();
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("open-markdown-dialog", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Open Markdown File",
    properties: ["openFile"],
    filters: [{ name: "Markdown", extensions: ["md", "markdown"] }, { name: "All Files", extensions: ["*"] }]
  });
  if (result.canceled || result.filePaths.length === 0) return { canceled: true };
  const filePath = result.filePaths[0];
  try {
    const content = await readTextFile(filePath);
    return { canceled: false, ok: true, filePath, content };
  } catch (err) {
    const code = err && typeof err === "object" ? err.code : null;
    const message = err && typeof err === "object" ? err.message : String(err || "");
    return { canceled: false, ok: false, filePath, error: code || "open_failed", message: message || "Open failed" };
  }
});

ipcMain.on("set-watched-file", (_evt, filePath) => {
  if (!filePath) {
    stopWatchingFile();
    return;
  }
  startWatchingFile(filePath);
});

ipcMain.handle("read-markdown-file", async (_evt, filePath) => {
  if (!filePath) return { ok: false, error: "missing_path" };
  try {
    const content = await readTextFile(filePath);
    return { ok: true, filePath, content };
  } catch (err) {
    const code = err && typeof err === "object" ? err.code : null;
    const message = err && typeof err === "object" ? err.message : String(err || "");
    return { ok: false, filePath, error: code || "read_failed", message: message || "Read failed" };
  }
});

ipcMain.handle("save-markdown-file", async (_evt, filePath, content) => {
  if (!filePath) return { ok: false, error: "missing_path" };
  try {
    await writeTextFile(filePath, content ?? "");
    return { ok: true };
  } catch (err) {
    const code = err && typeof err === "object" ? err.code : null;
    const message = err && typeof err === "object" ? err.message : String(err || "");
    return { ok: false, filePath, error: code || "write_failed", message: message || "Write failed" };
  }
});

ipcMain.handle("save-markdown-file-as", async (_evt, suggestedName, content) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "Save Markdown File",
    defaultPath: suggestedName || "note.md",
    filters: [{ name: "Markdown", extensions: ["md"] }, { name: "All Files", extensions: ["*"] }]
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  let filePath = result.filePath;
  if (!isMarkdownFile(filePath)) filePath += ".md";
  try {
    await writeTextFile(filePath, content ?? "");
    return { canceled: false, ok: true, filePath };
  } catch (err) {
    const code = err && typeof err === "object" ? err.code : null;
    const message = err && typeof err === "object" ? err.message : String(err || "");
    return { canceled: false, ok: false, filePath, error: code || "write_failed", message: message || "Write failed" };
  }
});

// macOS Finder "Open With" support.
app.on("open-file", async (event, filePath) => {
  event.preventDefault();
  await app.whenReady();
  if (!mainWindow) createWindow();
  await openMarkdownPath(filePath);
});
