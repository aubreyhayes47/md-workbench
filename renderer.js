const { ipcRenderer } = require("electron");
const { marked } = require("marked");
const createDOMPurify = require("dompurify");

const DOMPurify = createDOMPurify(window);

const openBtn = document.getElementById("openBtn");
const saveBtn = document.getElementById("saveBtn");
const toggleBtn = document.getElementById("toggleBtn");
const pathEl = document.getElementById("path");
const statusEl = document.getElementById("status");
const editor = document.getElementById("editor");
const preview = document.getElementById("preview");

let currentPath = null;
let mode = localStorage.getItem("mdw_mode") || "render"; // render|edit
let lastSavedContent = "";
let isDirty = false;

function setStatus(msg) {
  statusEl.textContent = msg || "";
  if (msg) setTimeout(() => (statusEl.textContent = ""), 2200);
}

function safeMode(m) {
  return m === "edit" || m === "render" ? m : "render";
}

function updateToggleLabel() {
  if (mode === "edit") toggleBtn.textContent = "Preview (Ctrl+E)";
  else toggleBtn.textContent = "Edit (Ctrl+E)";
}

function setPath(p) {
  currentPath = p || null;
  pathEl.textContent = currentPath || "No file loaded";
  ipcRenderer.send("set-watched-file", currentPath);
}

function renderMarkdown(md) {
  try {
    const raw = marked.parse(md || "");
    const clean = DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } });
    preview.innerHTML = clean;
  } catch (err) {
    const msg = err && typeof err === "object" ? err.message : String(err || "Render error");
    preview.innerHTML = `<pre><code>Markdown render error:\n${(msg || "").replaceAll("<", "&lt;")}</code></pre>`;
  }
}

function setDirty(nextDirty) {
  isDirty = !!nextDirty;
}

function setMode(nextMode) {
  mode = safeMode(nextMode);
  localStorage.setItem("mdw_mode", mode);
  updateToggleLabel();
  if (mode === "edit") {
    editor.classList.remove("hidden");
    preview.classList.add("hidden");
    editor.focus();
  } else {
    editor.classList.add("hidden");
    preview.classList.remove("hidden");
  }
}

function syncFromEditor() {
  renderMarkdown(editor.value);
}

function loadContentIntoEditor(content) {
  editor.value = content || "";
  lastSavedContent = editor.value;
  setDirty(false);
  syncFromEditor();
}

async function openViaDialog() {
  if (isDirty) {
    const ok = window.confirm("You have unsaved edits.\n\nOpen another file and discard them?");
    if (!ok) return;
  }

  const res = await ipcRenderer.invoke("open-markdown-dialog");
  if (res?.canceled) return;
  if (!res?.ok) {
    setStatus(`Open failed: ${res?.error || "unknown"}`);
    return;
  }
  setPath(res.filePath);
  loadContentIntoEditor(res.content || "");
  setMode(mode); // preserve last-used mode
  setStatus("Opened");
}

async function save() {
  const content = editor.value ?? "";
  if (!currentPath) {
    const suggested = "note.md";
    const res = await ipcRenderer.invoke("save-markdown-file-as", suggested, content);
    if (res?.canceled) return;
    if (!res?.ok) {
      setStatus(`Save failed: ${res?.error || "unknown"}`);
      return;
    }
    setPath(res.filePath);
    lastSavedContent = editor.value ?? "";
    setDirty(false);
    setStatus("Saved");
    return;
  }
  const res = await ipcRenderer.invoke("save-markdown-file", currentPath, content);
  if (res?.ok) {
    lastSavedContent = editor.value ?? "";
    setDirty(false);
    setStatus("Saved");
  }
  else setStatus(`Save failed: ${res?.error || "unknown"}`);
}

function toggle() {
  if (mode === "render") {
    setMode("edit");
  } else {
    syncFromEditor();
    setMode("render");
  }
}

openBtn.addEventListener("click", openViaDialog);
saveBtn.addEventListener("click", save);
toggleBtn.addEventListener("click", toggle);
editor.addEventListener("input", () => {
  setDirty((editor.value ?? "") !== (lastSavedContent ?? ""));
  if (mode === "render") syncFromEditor();
});

document.addEventListener("keydown", (e) => {
  const ctrl = e.ctrlKey || e.metaKey;
  if (!ctrl) return;
  const k = e.key.toLowerCase();
  if (k === "o") {
    e.preventDefault();
    openViaDialog();
  } else if (k === "s") {
    e.preventDefault();
    save();
  } else if (k === "e") {
    e.preventDefault();
    toggle();
  }
});

ipcRenderer.on("open-file", (_evt, payload) => {
  if (!payload?.filePath) return;
  if (isDirty) {
    const ok = window.confirm("You have unsaved edits.\n\nOpen another file and discard them?");
    if (!ok) return;
  }
  setPath(payload.filePath);
  loadContentIntoEditor(payload.content || "");
  setMode(mode); // preserve last-used mode
  setStatus("Opened");
});

ipcRenderer.on("open-file-error", (_evt, payload) => {
  const p = payload?.filePath || "";
  const code = payload?.code || "open_failed";
  setStatus(`Open failed: ${code}`);
  if (p) pathEl.textContent = p;
});

async function maybeReloadFromDisk({ forcePrompt } = {}) {
  if (!currentPath) return;

  if (!forcePrompt && isDirty) {
    const ok = window.confirm(
      "This file changed on disk.\n\nReload and discard your unsaved edits?"
    );
    if (!ok) return;
  }

  const res = await ipcRenderer.invoke("read-markdown-file", currentPath);
  if (!res?.ok) {
    const code = res?.error || "read_failed";
    if (code === "ENOENT") setStatus("File missing on disk");
    else setStatus(`Reload failed: ${code}`);
    return;
  }

  const next = res.content || "";
  if (!isDirty && next === (editor.value ?? "")) {
    // Common case: our own save triggered a watch event. No need to churn UI.
    lastSavedContent = editor.value ?? "";
    setDirty(false);
    return;
  }

  loadContentIntoEditor(next);
  setStatus("Reloaded from disk");
}

ipcRenderer.on("disk-file-changed", (_evt, payload) => {
  const p = payload?.filePath;
  if (!p || !currentPath) return;
  if (p !== currentPath) return;
  maybeReloadFromDisk();
});

// Initial state
editor.value = "";
renderMarkdown("");
setMode(safeMode(mode));
lastSavedContent = editor.value ?? "";
setDirty(false);

window.addEventListener("beforeunload", (e) => {
  if (!isDirty) return;
  e.preventDefault();
  e.returnValue = "";
});
