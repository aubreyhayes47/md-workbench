# md-workbench

Local Ubuntu desktop app to open, edit, render, and save Markdown files with a fast toggle between modes.

## Features

- Open `.md` files via file picker (Ctrl+O)
- Rendered Markdown view and plain text edit mode (Ctrl+E toggles)
- Save back to disk (Ctrl+S), or Save As on first save
- Preserves last-used mode (Edit or Preview) across file opens and restarts
- Prompts before discarding unsaved edits when opening another file
- Also accepts a file path argument: `npm start -- /path/to/file.md`

## Requirements

- Node.js + npm

## Quick Start (Ubuntu)

```bash
git clone https://github.com/aubreyhayes47/md-workbench.git
cd md-workbench
npm install
npm start
```

### Set As Default Markdown Opener (xdg-mime)

This installs a `.desktop` entry to `~/.local/share/applications/md-workbench.desktop` and sets it as the default handler for Markdown:

```bash
./scripts/install_default_opener.sh
```

Verify:

```bash
xdg-mime query default text/markdown
xdg-mime query default text/x-markdown
```

Test:

```bash
xdg-open /path/to/file.md
```

Note: the `.desktop` file's `Exec=` points at the current folder location; if you move the repo, rerun `./scripts/install_default_opener.sh`.

## Install

```bash
cd /home/aubrey/Desktop/md-workbench
npm install
```

## Run

```bash
npm start
```

Open a specific file:

```bash
npm start -- /home/aubrey/Desktop/dracula_in_wonderland.md
```

## Verify (Checklist)

1. Launch the app.
2. Open a Markdown file (Ctrl+O).
3. Toggle to edit mode (Ctrl+E), change text.
4. Save (Ctrl+S).
5. Toggle back to render mode (Ctrl+E) and confirm preview updates.
6. While the file is open, edit it in another editor and save; md-workbench should auto-reload if you have no unsaved edits, or prompt you if you do.
7. With unsaved edits, try to open another file and confirm you get a confirm prompt.
8. Try to open a missing file via `npm start -- /path/does/not/exist.md` and confirm you get an error in the toolbar status.

## Notes

This is a minimal Electron stack (no bundler) for ease of maintenance.
