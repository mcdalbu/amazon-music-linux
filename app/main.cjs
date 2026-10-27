"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  { pathToFileURL } = require("node:url"),
  { spawn } = require("node:child_process");
const { gi, GLib, Gio, Gtk, Gdk, Adw } = require("./gi.cjs");
const {
  Settings,
  refreshRate,
  drmState,
  scrollInput,
} = require("./settings.cjs");
const {
  REGIONS,
  isAmazonURL,
  externalURL,
  cleanMedia,
} = require("../electron/policy.cjs");
const root = path.resolve(__dirname, ".."),
  args = new Set(process.argv.slice(2));
for (const arg of args)
  if (
    ![
      "--preview",
      "--smoke-test",
      "--enable-gpu",
      "--disable-gpu",
      "--diagnostics",
      "--check-web",
    ].includes(arg)
  )
    throw Error("Unknown option: " + arg);
const test = args.has("--preview") || args.has("--smoke-test"),
  temporary = test || args.has("--diagnostics") || args.has("--check-web");
const settings = new Settings(temporary);
const gpu =
  !args.has("--disable-gpu") &&
  (args.has("--enable-gpu") || settings.value.hardwareAcceleration);
const autoRenderer = !process.env.GSK_RENDERER;
if (autoRenderer) process.env.GSK_RENDERER = gpu ? "vulkan" : "gl";
process.env.AMZML_TEST = test ? "1" : "0";
const { Engine } = require("./engine.cjs"),
  { Desktop } = require("./desktop.cjs");
class MusicApp {
  constructor() {
    this.app = new Adw.Application({
      applicationId: "io.github.amzml.AmazonMusic" + (temporary ? ".Test" : ""),
      flags: temporary
        ? Gio.ApplicationFlags.NON_UNIQUE
        : Gio.ApplicationFlags.DEFAULT_FLAGS,
    });
    this.app.on("activate", () => this.activate());
    this.media = { available: false, paused: true };
    this.components = {};
    this.drm = { ready: false, error: "" };
    this.tick = 0;
    this.frames = 0;
    this.lastPresent = 0;
    this.rate = 0;
    this.background = false;
    this.closing = false;
    this.ready = false;
    this.startup = new Set();
    try {
      for (const folder of fs.readdirSync(
        path.join(settings.profile, "WidevineCdm"),
      )) {
        try {
          this.startup.add(
            JSON.parse(
              fs.readFileSync(
                path.join(
                  settings.profile,
                  "WidevineCdm",
                  folder,
                  "manifest.json",
                ),
              ),
            ).version,
          );
        } catch {}
      }
    } catch {}
  }
  action(name, callback, keys = []) {
    const a = new Gio.SimpleAction({ name });
    a.on("activate", callback);
    this.app.addAction(a);
    if (keys.length) this.app.setAccelsForAction("app." + name, keys);
    return a;
  }
  activate() {
    if (this.window) {
      this.command("open");
      return;
    }
    this.app.hold();
    this.window = new Adw.ApplicationWindow({
      application: this.app,
      title: "Amazon Music Linux",
      defaultWidth: 1280,
      defaultHeight: 860,
    });
    this.window.setIconName("io.github.amzml.AmazonMusic");
    this.window.setSizeRequest(720, 480);
    this.window.on("close-request", () => {
      if (settings.value.background && !this.closing) {
        this.hide();
        return true;
      }
      this.quit();
      return true;
    });
    this.toolbar = new Adw.ToolbarView();
    this.header = new Adw.HeaderBar();
    this.header.setTitleWidget(
      new Adw.WindowTitle({ title: "Amazon Music", subtitle: "" }),
    );
    this.button("go-home-symbolic", "Início", () => this.home());
    this.button("view-refresh-symbolic", "Recarregar", () =>
      this.engine?.send("reload"),
    );
    this.play = this.button(
      "media-playback-start-symbolic",
      "Reproduzir ou pausar",
      () => this.command("toggle"),
    );
    this.play.setSensitive(false);
    this.spinner = new Gtk.Spinner();
    this.header.packEnd(this.spinner);
    const menu = new Gio.Menu();
    for (const [label, name] of [
      ["Preferências", "preferences"],
      ["Ampliar", "zoom-in"],
      ["Reduzir", "zoom-out"],
      ["Zoom padrão", "zoom-reset"],
      ["Ir para segundo plano", "hide"],
      ["Sobre", "about"],
      ["Sair", "quit"],
    ])
      menu.append(label, "app." + name);
    this.header.packEnd(
      new Gtk.MenuButton({
        iconName: "open-menu-symbolic",
        menuModel: menu,
        tooltipText: "Menu",
      }),
    );
    this.toolbar.addTopBar(this.header);
    this.banner = new Adw.Banner({
      title:
        "Widevine foi instalado. Reinicie para ativar a reprodução protegida.",
      buttonLabel: "Reiniciar",
      revealed: false,
    });
    this.banner.on("button-clicked", () => this.restart());
    this.toolbar.addTopBar(this.banner);
    this.stack = new Gtk.Stack({ hexpand: true, vexpand: true });
    this.overlay = new Gtk.Overlay({
      hexpand: true,
      vexpand: true,
      focusable: true,
    });
    this.picture = new Gtk.Picture({
      hexpand: true,
      vexpand: true,
      canShrink: true,
      contentFit: Gtk.ContentFit.FILL,
      alternativeText: "Player do Amazon Music",
    });
    this.overlay.setChild(this.picture);
    this.stack.addNamed(this.overlay, "player");
    this.status = new Adw.StatusPage({
      title: "Carregando Amazon Music",
      description: "Preparando o player…",
      iconName: "io.github.amzml.AmazonMusic",
    });
    const retry = new Gtk.Button({
      label: "Tentar novamente",
      halign: Gtk.Align.CENTER,
    });
    retry.addCssClass("suggested-action");
    retry.on("clicked", () => this.home());
    this.status.setChild(retry);
    this.stack.addNamed(this.status, "status");
    this.stack.setVisibleChildName("status");
    this.toolbar.setContent(this.stack);
    this.window.setContent(this.toolbar);
    this.action("preferences", () => this.preferences(), ["<Control>comma"]);
    this.action("home", () => this.home(), ["<Alt>Home"]);
    this.action("reload", () => this.engine?.send("reload"), ["<Control>r"]);
    this.action("quit", () => this.quit(), ["<Control>q"]);
    this.hideAction = this.action("hide", () => this.hide());
    this.hideAction.setEnabled(settings.value.background);
    this.action("zoom-in", () => this.zoom(1), [
      "<Control>plus",
      "<Control>equal",
    ]);
    this.action("zoom-out", () => this.zoom(-1), ["<Control>minus"]);
    this.action(
      "zoom-reset",
      () => {
        this.zoomLevel = 0;
        this.engine?.send("zoom", { level: 0 });
      },
      ["<Control>0"],
    );
    this.action("about", () => this.about());
    this.zoomLevel = 0;
    this.installInput();
    this.style = Adw.StyleManager.getDefault();
    this.style.on("notify::dark", () => this.syncTheme());
    this.syncTheme();
    this.desktop = new Desktop(
      root,
      settings.directory,
      (command) => this.command(command),
      temporary,
    );
    this.presentWindow();
    setTimeout(() => this.start(), 0);
  }
  presentWindow() {
    GLib.idleAdd(0, () => {
      if (!this.closing) this.window.present();
      return false;
    });
  }
  button(icon, tip, callback) {
    const b = new Gtk.Button({ iconName: icon, tooltipText: tip });
    b.on("clicked", callback);
    this.header.packStart(b);
    return b;
  }
  url() {
    return test
      ? pathToFileURL(path.join(root, "tests/player_fixture.html")).href
      : REGIONS[settings.value.region].url;
  }
  start() {
    try {
      process.env.AMZML_SCALE = String(this.window.getScaleFactor());
      this.engine = new Engine(root, settings.profile, this.url(), {
        gpu,
        onFrame: () => this.schedule(),
        onEvent: (k, v) => this.event(k, v),
        onExit: (code, signal) => {
          if (this.closing) this.finish();
          else this.error("O processo do player encerrou: " + (signal || code));
        },
      });
      this.engine.send("mute", { muted: settings.value.mute });
      this.syncTheme();
      this.syncTray();
      this.deadline = Date.now() + 40000;
      this.syncSize();
      this.timer = GLib.timeoutAdd(0, 250, () => {
        this.maintain();
        return !this.closing;
      });
      this.maintenance = 0;
      this.window.on("notify::scale-factor", () => this.syncSize());
      if (args.has("--smoke-test")) {
        const { smoke } = require("./smoke.cjs");
        smoke(this);
      }
      if (args.has("--check-web"))
        setTimeout(() => {
          console.log(
            "WEB_CHECK",
            JSON.stringify({
              ready: this.ready,
              frames: this.frames,
              drm: this.drm,
              state: this.engine.state,
            }),
          );
          this.exitCode = this.ready && this.drm.ready ? 0 : 1;
          this.quit();
        }, 35000);
    } catch (error) {
      console.error(error);
      this.error(error.message);
      if (args.has("--smoke-test")) {
        this.exitCode = 1;
        this.quit();
      }
    }
  }
  event(kind, text) {
    try {
      if (kind === 2) {
        this.ready = isAmazonURL(text) || (test && text === this.url());
        if (this.ready) {
          this.deadline = 0;
          this.spinner.setSpinning(false);
          this.stack.setVisibleChildName("player");
        }
      } else if (kind === 3)
        this.error("Não foi possível carregar o player: " + text);
      else if (kind === 4) {
        if (isAmazonURL(text)) this.engine.send("load", { url: text });
        else {
          const url = externalURL(text);
          if (url) Gio.AppInfo.launchDefaultForUri(url, null);
        }
      } else if (kind === 5) {
        const m = cleanMedia(JSON.parse(text));
        if (m) {
          this.media = m;
          this.play.setSensitive(m.available);
          this.play.setIconName(
            m.paused
              ? "media-playback-start-symbolic"
              : "media-playback-pause-symbolic",
          );
          this.desktop.update(m, settings.value.mute);
          this.syncTray();
        }
      } else if (kind === 6) {
        this.drm = JSON.parse(text);
        this.updateDRM();
      } else if (kind === 14) {
        const c = JSON.parse(text);
        this.components[c.id] = c;
        this.updateDRM();
      } else if (kind === 15) {
        this.componentError = Number(text);
        this.updateDRM();
      } else if (kind === 17)
        this.command(
          text === "mute"
            ? settings.value.mute
              ? "mute-off"
              : "mute-on"
            : text === "toggle"
              ? "toggle"
              : text,
        );
      else if (kind === 18) {
        this.memoryReport = JSON.parse(text);
      } else if (kind === 11) {
        this.reports ??= [];
        this.reports.push(JSON.parse(text));
      }
    } catch (error) {
      console.error("Engine event:", error);
    }
  }
  error(message) {
    if (this.closing) return;
    this.spinner.setSpinning(false);
    this.status.setTitle("Não foi possível abrir o Amazon Music");
    this.status.setDescription(message.slice(0, 500));
    this.stack.setVisibleChildName("status");
    console.error(message);
  }
  home() {
    if (this.engine?.closed) {
      this.restart();
      return;
    }
    this.status.setTitle("Carregando Amazon Music");
    this.status.setDescription("Preparando o player…");
    this.stack.setVisibleChildName("status");
    this.spinner.setSpinning(true);
    this.deadline = Date.now() + 40000;
    this.engine?.send("load", { url: this.url() });
  }
  syncSize() {
    if (!this.engine || this.closing) return;
    const w = this.overlay.getWidth(),
      h = this.overlay.getHeight(),
      factor = this.window.getScaleFactor();
    if (w < 1 || h < 1) return;
    const size = [w, h, factor].join(",");
    if (size !== this.size) {
      this.size = size;
      this.engine.send("resize", { width: w, height: h, factor });
    }
    this.syncRate();
  }
  syncRate() {
    const surface = this.window.getSurface(),
      monitor = surface
        ? this.window.getDisplay().getMonitorAtSurface(surface)
        : null;
    const rate = refreshRate(monitor?.getRefreshRate() || 0);
    if (rate !== this.rate) {
      this.rate = rate;
      this.engine.send("frame-rate", { fps: rate });
    }
  }
  schedule() {
    if (this.closing || this.background) return;
    this.activeUntil = performance.now() + 25;
    if (!this.tick)
      this.tick = this.picture.addTickCallback(() => this.present());
  }
  present() {
    if (process.env.AMZML_DEBUG === "1")
      console.log("TICK", !!this.engine.pending);
    if (!this.closing && !this.background && this.engine) {
      if (this.engine.present(BigInt(gi.System.addressOf(this.picture)))) {
        this.frames++;
        this.lastPresent = performance.now();
      }
      if (performance.now() < this.activeUntil) return true;
    }
    this.tick = 0;
    return false;
  }
  maintain() {
    if (this.closing) return;
    this.syncSize();
    if (this.deadline && Date.now() > this.deadline) {
      this.deadline = 0;
      this.error(
        "O Amazon Music demorou para responder. Verifique sua conexão.",
      );
    }
    // The compositor can pause GTK ticks for covered windows. Consume a
    // pending frame at most at 4 Hz until normal frame-clock delivery resumes.
    if (
      this.engine.pending &&
      !this.background &&
      (!this.picture.getMapped() || performance.now() - this.lastPresent > 250)
    ) {
      if (this.engine.present(BigInt(gi.System.addressOf(this.picture)))) {
        this.frames++;
        this.lastPresent = performance.now();
      }
    }
    if (Date.now() - this.maintenance > 1000) {
      this.maintenance = Date.now();
      this.engine.send("components");
      if (process.env.AMZML_DEBUG === "1")
        console.log(
          "NODE_STATE",
          JSON.stringify({
            ready: this.ready,
            frames: this.frames,
            pending: !!this.engine.pending,
            state: this.engine.state,
            buffer: this.engine.buffer.length,
          }),
        );
    }
  }
  syncTheme() {
    const schemes = {
      system: Adw.ColorScheme.DEFAULT,
      dark: Adw.ColorScheme.FORCE_DARK,
      light: Adw.ColorScheme.FORCE_LIGHT,
    };
    this.style.setColorScheme(schemes[settings.value.theme]);
    this.engine?.send("theme", {
      theme: this.style.getDark() ? "dark" : "light",
    });
  }
  syncTray() {
    this.engine?.send("tray", {
      enabled: settings.value.background,
      media: this.media,
      muted: settings.value.mute,
    });
  }
  save(changes) {
    settings.save(changes);
    this.hideAction.setEnabled(settings.value.background);
    this.syncTheme();
    this.engine?.send("mute", { muted: settings.value.mute });
    this.desktop?.update(this.media, settings.value.mute);
    this.syncTray();
    if (this.background && !settings.value.background) this.command("open");
  }
  hide() {
    if (!settings.value.background || this.closing) return;
    this.background = true;
    this.window.setVisible(false);
    this.engine?.setForeground(false);
    GLib.idleAdd(0, () => {
      if (this.background && !this.closing) this.picture.setPaintable(null);
      return false;
    });
  }
  command(command) {
    if (command === "quit") return this.quit();
    if (command === "open") {
      this.background = false;
      this.presentWindow();
      this.engine?.setForeground(true);
      this.syncSize();
      if (this.engine?.pending) this.schedule();
    } else if (command === "mute-on" || command === "mute-off")
      this.save({ mute: command === "mute-on" });
    else if (
      this.media.available &&
      ["play", "pause", "toggle", "next", "previous"].includes(command)
    )
      this.engine?.send("media", { action: command });
  }
  zoom(amount) {
    this.zoomLevel = Math.max(-2, Math.min(3, this.zoomLevel + amount));
    this.engine?.send("zoom", { level: this.zoomLevel });
  }
  updateDRM() {
    const state = drmState(
      this.components.widevine,
      this.drm.ready,
      this.startup,
    );
    this.banner.setRevealed(state === "restart");
    const labels = {
      ready: "Widevine disponível",
      preparing: "Verificando ou instalando Widevine…",
      restart: "Widevine instalado nesta execução. Reinicie para ativar.",
      unavailable: "Widevine indisponível: " + this.drm.error,
    };
    if (this.drmRow)
      this.drmRow.setSubtitle(
        labels[state] +
          (this.componentError
            ? " Falha na atualização: " + this.componentError
            : ""),
      );
    if (
      this.components.widevine?.version === "0.0.0.0" &&
      !this.updateRequested &&
      !test
    ) {
      this.updateRequested = true;
      this.engine.send("update");
    }
  }
  preferences() {
    if (this.prefs) {
      this.prefs.present(this.window);
      return;
    }
    const dialog = new Adw.PreferencesDialog({ title: "Preferências" });
    this.prefs = dialog;
    dialog.on("closed", () => {
      this.prefs = null;
      this.drmRow = null;
    });
    const page = new Adw.PreferencesPage();
    dialog.add(page);
    const general = new Adw.PreferencesGroup({ title: "Aparência e player" });
    page.add(general);
    const combo = (group, title, choices, index, changed) => {
      const row = new Adw.ComboRow({
        title,
        model: Gtk.StringList.new(choices),
        selected: index,
      });
      row.on("notify::selected", () => changed(row.getSelected()));
      group.add(row);
      return row;
    };
    this.themeRow = combo(
      general,
      "Aparência",
      ["Sistema", "Clara", "Escura"],
      ["system", "light", "dark"].indexOf(settings.value.theme),
      (i) => this.save({ theme: ["system", "light", "dark"][i] }),
    );
    const regions = Object.keys(REGIONS);
    combo(
      general,
      "Região do Amazon Music",
      regions.map((r) => REGIONS[r].label),
      regions.indexOf(settings.value.region),
      (i) => {
        this.save({ region: regions[i] });
        this.home();
      },
    );
    const desktop = new Adw.PreferencesGroup({
      title: "Integração com o desktop",
    });
    page.add(desktop);
    const background = new Adw.SwitchRow({
      title: "Executar em segundo plano",
      subtitle:
        "Fechar a janela mantém a reprodução. No GNOME, o ícone requer a extensão AppIndicator.",
      active: settings.value.background,
    });
    background.on("notify::active", () =>
      this.save({ background: background.getActive() }),
    );
    desktop.add(background);
    this.backgroundRow = background;
    const perf = new Adw.PreferencesGroup({ title: "Desempenho" });
    page.add(perf);
    const acceleration = new Adw.SwitchRow({
      title: "Aceleração de hardware",
      subtitle:
        "Reinicie o aplicativo para aplicar. A disponibilidade depende do driver.",
      active: settings.value.hardwareAcceleration,
    });
    acceleration.on("notify::active", () =>
      this.save({ hardwareAcceleration: acceleration.getActive() }),
    );
    perf.add(acceleration);
    this.gpuRow = acceleration;
    const runtime = new Adw.ActionRow({
      title: "Renderização",
      subtitle:
        (this.engine?.state.hardwareAcceleration
          ? "GPU solicitada"
          : "Software") +
        " · monitor " +
        this.rate +
        " Hz · renderização reduzida quando ocioso",
    });
    perf.add(runtime);
    const restart = new Gtk.Button({
      label: "Reiniciar",
      valign: Gtk.Align.CENTER,
    });
    restart.on("clicked", () => this.restart());
    runtime.addSuffix(restart);
    const drm = new Adw.PreferencesGroup({ title: "Reprodução protegida" });
    page.add(drm);
    this.drmRow = new Adw.ActionRow({ title: "Widevine" });
    drm.add(this.drmRow);
    const verify = new Gtk.Button({
      label: "Verificar CDM",
      valign: Gtk.Align.CENTER,
    });
    verify.on("clicked", () => this.engine.send("update"));
    this.drmRow.addSuffix(verify);
    drm.add(
      new Adw.ActionRow({
        title: "Qualidade de áudio",
        subtitle:
          "A qualidade é a fornecida pela Amazon. HD/Ultra HD dependem do serviço, da conta e do DRM.",
      }),
    );
    this.updateDRM();
    GLib.idleAdd(0, () => {
      dialog.present(this.window);
      return false;
    });
  }
  about() {
    const dialog = new Adw.AboutDialog({
      applicationName: "Amazon Music Linux",
      applicationIcon: "io.github.amzml.AmazonMusic",
      version: require("../package.json").version,
      developerName: "Amazon Music Linux contributors",
      licenseType: Gtk.License.MIT_X11,
      comments:
        "Cliente independente em Node.js, GTK4/libadwaita e CastLabs Electron.",
    });
    GLib.idleAdd(0, () => {
      dialog.present(this.window);
      return false;
    });
  }
  installInput() {
    const mods = (state) =>
      (state & Gdk.ModifierType.SHIFT_MASK ? 2 : 0) |
      (state & Gdk.ModifierType.CONTROL_MASK ? 4 : 0) |
      (state & Gdk.ModifierType.ALT_MASK ? 8 : 0);
    this.pointer = { x: 0, y: 0 };
    const send = (event) => {
      this.engine?.send("mouse", {
        event: { ...event, x: this.pointer.x, y: this.pointer.y },
      });
    };
    const motion = new Gtk.EventControllerMotion();
    motion.on("motion", (x, y) => {
      this.pointer = { x, y };
      send({ type: "mouseMove", modifiers: [] });
    });
    this.overlay.addController(motion);
    const click = new Gtk.GestureClick({ button: 0 });
    const buttons = ["", "left", "middle", "right"];
    click.on("pressed", (count, x, y) => {
      this.pointer = { x, y };
      this.overlay.grabFocus();
      send({
        type: "mouseDown",
        button: buttons[click.getCurrentButton()] || "left",
        clickCount: count,
      });
    });
    click.on("released", (count, x, y) => {
      this.pointer = { x, y };
      send({
        type: "mouseUp",
        button: buttons[click.getCurrentButton()] || "left",
        clickCount: count,
      });
    });
    this.overlay.addController(click);
    const scroll = new Gtk.EventControllerScroll({
      flags: Gtk.EventControllerScrollFlags.BOTH_AXES,
    });
    scroll.on("scroll", (dx, dy) => {
      const precise = scroll.getUnit() === Gdk.ScrollUnit.SURFACE;
      send(scrollInput(dx, dy, precise));
      return true;
    });
    this.overlay.addController(scroll);
    this.im = new Gtk.IMMulticontext();
    this.im.setClientWidget(this.overlay);
    this.im.on("commit", (text) => this.engine?.send("text", { text }));
    const keys = new Gtk.EventControllerKey();
    keys.setImContext(this.im);
    const keyEvent = (type, key, state) => {
      const special = {
        BackSpace: "Backspace",
        Return: "Enter",
        space: "Space",
        Page_Up: "PageUp",
        Page_Down: "PageDown",
        Escape: "Escape",
      };
      const name = Gdk.keyvalName(key),
        code = special[name] || name;
      const modifiers = [];
      if (state & Gdk.ModifierType.SHIFT_MASK) modifiers.push("shift");
      if (state & Gdk.ModifierType.CONTROL_MASK) modifiers.push("control");
      if (state & Gdk.ModifierType.ALT_MASK) modifiers.push("alt");
      this.engine?.send("key", { event: { type, keyCode: code, modifiers } });
    };
    keys.on("key-pressed", (key, _code, state) => {
      const name = (Gdk.keyvalName(key) || "").toLowerCase();
      if (state & Gdk.ModifierType.CONTROL_MASK) {
        if (["q", "r", "comma", "plus", "equal", "minus", "0"].includes(name))
          return false;
        const action = { c: "copy", x: "cut", v: "paste", a: "select_all" }[
          name
        ];
        if (action) {
          this.engine?.send("edit", { action });
          return true;
        }
      }
      keyEvent("keyDown", key, state);
      return true;
    });
    keys.on("key-released", (key, _code, state) =>
      keyEvent("keyUp", key, state),
    );
    this.overlay.addController(keys);
    const focus = new Gtk.EventControllerFocus();
    focus.on("enter", () => this.engine?.send("focus", { active: true }));
    focus.on("leave", () => this.engine?.send("focus", { active: false }));
    this.overlay.addController(focus);
  }
  restart() {
    if (this.closing) return;
    const env = { ...process.env };
    if (autoRenderer) delete env.GSK_RENDERER;
    this.relaunch = () => {
      const child = spawn(
        process.execPath,
        [
          path.join(root, "app/main.cjs"),
          ...process.argv
            .slice(2)
            .filter((v) => !["--enable-gpu", "--disable-gpu"].includes(v)),
        ],
        { env, detached: true, stdio: "ignore" },
      );
      child.unref();
    };
    this.quit();
  }
  quit() {
    if (this.closing) return;
    this.closing = true;
    if (this.timer) GLib.sourceRemove(this.timer);
    // Wayland focus/roundtrips must run in dispatch, never GLib's prepare phase
    // where node-gtk drains Promise continuations while a display read is armed.
    GLib.idleAdd(0, () => {
      if (this.tick) {
        this.picture.removeTickCallback(this.tick);
        this.tick = 0;
      }
      this.picture?.setPaintable(null);
      this.prefs?.close();
      this.window?.destroy();
      if (this.engine && !this.engine.closed) this.engine.stop();
      else this.finish();
      return false;
    });
  }
  finish() {
    if (this.finished) return;
    this.finished = true;
    this.engine?.dispose();
    this.desktop?.close();
    settings.cleanup();
    this.app.release();
    this.app.quit();
    this.relaunch?.();
    setTimeout(() => process.exit(this.exitCode || 0), 10);
  }
  run() {
    this.app.run([]);
  }
}
const client = new MusicApp();
process.on("SIGINT", () => client.quit());
process.on("SIGTERM", () => client.quit());
client.run();
