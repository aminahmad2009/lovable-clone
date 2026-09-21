# 8 · Desktop app & packaging

`electron/main.js` wraps the same zero-dependency server in a native window. It is a thin shell: no
IPC-driven features beyond opening external links, and no second Node runtime.

## Boot sequence

1. **Single-instance lock.** `app.requestSingleInstanceLock()`; a second launch quits and focuses the
   running window via the `second-instance` event.
2. **Port discovery.** `getFreePort(4310)` probes upward for up to 60 ports, so a desktop app and a
   CLI run can coexist.
3. **Data directory.** Packaged: `%APPDATA%/Lovable Local/data` (`app.getPath('userData')`) — because
   `resources/app` is read-only after install. In dev: the repository's `./data`, so both modes see
   the same projects.
4. **Environment first, import second.** `PORT`, `HOST` and `LOVABLE_DATA_DIR` are set *before*
   `await import('../server/index.js')`, since `server/config.js` reads them at module-evaluation
   time. Importing statically would bake in the defaults.
5. **Readiness wait.** `waitForServer()` polls `/api/health` every 250 ms for up to 25 s before the
   window loads the URL.
6. **Window + tray.** 1440×900 (min 940×600), dark background, `autoHideMenuBar: true`,
   `contextIsolation: true`, `nodeIntegration: false`, preload at `electron/preload.cjs`.

## Window behaviour

- **No native menubar.** `Menu.setApplicationMenu(null)` removes File/Edit/View/Window entirely; the
  tray menu and the in-app UI cover everything, and Chromium still handles clipboard shortcuts in
  inputs. `app.setAboutPanelOptions` still registers product name, version, product ID, publisher,
  copyright and repository so OS-level metadata is correct.
- **Close hides to tray.** The `close` event is intercepted unless the app is really quitting; only
  the tray's **Quit** exits. `window-all-closed` is a no-op so the app survives with no window.
- **External links.** `setWindowOpenHandler` sends any `http(s)` target to the system browser instead
  of opening a bare Electron window — that matters for "Open ↗" on the preview. The preload bridge
  exposes an `open-external` IPC channel for the same purpose.
- **Tray.** Icon resized to 16×16, tooltip `Lovable Local v0.2.0 — CodeWoxy`, menu showing product
  name and publisher (disabled header rows), Open, Open in Browser, Quit. Clicking the tray icon
  restores the window.

## Shutdown

`before-quit` is prevented once, `manager.stopAll()` is imported dynamically and awaited so every
child Vite process is killed, then `app.exit(0)`. Without this, orphaned dev servers keep their ports
after the app closes.

## Packaging

`package.json → build` drives electron-builder:

```jsonc
{
  "appId": "com.codewoxy.lovable-local",
  "productName": "Lovable Local",
  "copyright": "Copyright © 2026 CodeWoxy",
  "artifactName": "${productName}-Setup-${version}.${ext}",
  "asar": false,
  "files": ["server/**/*", "web/**/*", "electron/**/*", "build/icon.png",
            "package.json", "README.md", "CHANGELOG.md", "docs/**/*"],
  "win": { "target": [{ "target": "nsis", "arch": ["x64"] }], "publisherName": "CodeWoxy" },
  "nsis": { "oneClick": false, "perMachine": false, "allowToChangeInstallationDirectory": true,
            "createDesktopShortcut": true, "createStartMenuShortcut": true }
}
```

Notes:

- **`asar: false`** keeps the app as plain files. The server spawns `npm`, `npx` and `git` from the
  system PATH and reads its own templates from disk, which is simpler to reason about unpacked.
- **Versioned artifacts.** `artifactName` puts the semver in the installer filename, so
  `Lovable Local-Setup-0.2.0.exe` cannot be confused with an older build.
- `release/` is git-ignored; installers are ~80 MB and reproducible from source.

### Building

```bash
npm install          # once
npm run dist:win     # → release/Lovable Local-Setup-0.2.0.exe
```

If the build fails with `ERR_ELECTRON_BUILDER_CANNOT_EXECUTE` or "Access is denied" on a DLL, a
previous instance is still running and holding `release/win-unpacked`:

```bash
taskkill //IM "Lovable Local.exe" //F
rm -rf release/win-unpacked
npm run dist:win
```

The first build on a machine downloads Electron and the winCodeSign package; a corporate proxy or a
stale cache is the usual cause of a hang there.

### Verifying a build

```bash
node -e "const p=require('./package.json');console.log(p.version, p.build.appId)"
npm run version:check          # CHANGELOG has an entry for this version
```

Then install, launch, and confirm the sidebar version chip and the About panel both show the version
you intended, and that the data directory is under `%APPDATA%`.
