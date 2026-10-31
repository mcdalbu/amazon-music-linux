# Chromium wrapper validation — 2026-10-31

Host: Fedora 44, GNOME/Wayland, x86_64.

- Chromium 156.0.8078.47: live integration passed.
- Google Chrome 156.0.8078.79: live integration passed.
- Wayland protocol confirmed the actual window app ID as
  `io.github.amzml.pwa.chrome-music.amazon.com.br__-Default`, matching the packaged
  desktop entry. X11 `StartupWMClass` is configured; X11 was not exercised.
- Native MPRIS published the synthetic track's title, artist and album artwork.
  Calls to Pause, Play, Next and Previous changed playback/track state correctly.
- Native Chromium MPRIS has no app-specific DesktopEntry or functional Raise;
  GNOME may label the media service Chromium/Chrome. Open the window via its
  Amazon Music launcher/shelf icon.
- Launcher tests passed for an isolated private profile, executable/profile paths
  containing spaces, desktop ID agreement and invalid arguments/paths.
- All existing unit-test files passed; shell syntax and desktop entry validation
  passed.
- Built `amazon-music-pwa-0.6.0-1.fc44.noarch.rpm` (about 31 KiB) and inspected its
  file list and browser dependency. It includes the shell launcher, desktop entry,
  both icon formats, license and README. No browser/runtime is bundled.
- SHA-256 checksum verified. The RPM was built and inspected, not installed.

The live tests used disposable browser profiles and a local fixture with synthetic
audio. Authenticated Amazon Music streaming, Widevine playback, HD/Ultra HD and
visual pinning/grouping inside the GNOME shelf were not tested. The shelf identity
was verified at the Wayland protocol and package desktop-entry level.
