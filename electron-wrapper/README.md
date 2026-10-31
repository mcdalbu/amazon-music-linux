# Amazon Music

Standalone Amazon Music wrapper for Linux. The RPM bundles CastLabs Electron
44.5.1+wvcus, so **Chrome, Chromium and Node.js do not need to be installed**.
It uses one regular Electron browser window, without the GTK/offscreen frame
pipeline of the older client.

```bash
sudo dnf install ./dist/amazon-music-electron-0.7.2-1.fc44.x86_64.rpm
amazon-music-electron
```

Open **Amazon Music** from the launcher and pin its blue smile icon to
the dock/shelf. Closing the window hides it and keeps music playing. Click the
tray icon or choose **Abrir Amazon Music** to restore it. Its menu also offers
play/pause, previous/next, mute and **Sair**. Use Sair or Ctrl+Q to stop the app.
You can disable close-to-background in the application menu. `--background` starts
without showing the window.

On GNOME, displaying tray icons requires the **AppIndicator and KStatusNotifierItem
Support** extension, as with the previous version. The wrapper does not install
extensions. If no tray host is present, reopen through the application launcher
or the GNOME media player. Creating a Tray object does not guarantee that the
current desktop displays it.

The GNOME mini player uses an app-specific MPRIS service with Amazon Music's
identity, track metadata, album art, play/pause, previous/next and Raise. Controls
are available when exposed by the website's Media Session. A sandboxed preload
observes media state; the Amazon page receives no Node.js or Electron API.

A small process-local GTK3 bridge synchronizes native title bars and menus with the desktop preference, including Adwaita-dark. It does not change the system theme. Native menus, the window background and the page prefers-color-scheme follow the system appearance through the desktop settings portal, including live changes. Without a portal, Electron native detection is used. Amazon controls the website’s own colors.

The app starts on Amazon Music Brasil. Eight regions are available in the menu.
Settings, cookies and the artwork cache are separate from the older GTK client,
the Chromium wrapper and your personal browser, under
`~/.config/amazon-music-electron/` (respects `XDG_CONFIG_HOME`). Sign in again when
first opening this version. Session data is retained across RPM upgrades.

The bundled CastLabs component updater supplies Widevine; the CDM is not
redistributed in the package. An Amazon account and a supported region/plan are
required. Authenticated playback and HD/Ultra HD still need testing with a real
account. No offline downloads or bit-perfect/exclusive audio are provided.

Development requires a C compiler and GTK3 headers (`gcc gtk3-devel pkgconf-pkg-config` on Fedora), plus the existing Node.js dependencies. The Node-API appearance module is included in the RPM; installed users do not need build tools.

Development:

```bash
./scripts/run-electron.sh
./scripts/node.sh tests/electron-live.cjs
./scripts/node.sh scripts/build-electron.cjs
```

The live test creates a disposable profile and synthetic media fixture. It checks
the real Wayland ID, tray registration/menu actions, background playback and MPRIS.
No remote debugging port is opened. `--smoke-test` requires a temporary
`AMZML_ELECTRON_TEST_DIR`; it loads only the included test fixture, never Amazon.

Electron API references: [desktop identity](https://www.electronjs.org/docs/latest/api/app#appsetdesktopnamename-linux),
[Linux tray behavior](https://www.electronjs.org/docs/latest/api/tray).
