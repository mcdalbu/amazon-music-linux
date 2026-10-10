#!/usr/bin/python3
"""GTK4/libadwaita Amazon Music shell with a hidden offscreen Electron backend."""
import argparse
import json
import math
import os
from pathlib import Path
import shutil
import stat
import sys
import tempfile
import time
import traceback
import gi
gi.require_version('Gtk', '4.0')
gi.require_version('Adw', '1')
gi.require_version('Gdk', '4.0')
from gi.repository import Adw, Gdk, Gio, GLib, Gtk
from electron import Electron
from mpris import Mpris
from appearance import Appearance
from tray import TrayHost
from policy import REGIONS, amazon_url, music_url, https_url, clean_settings, clean_media
from drm import WIDEVINE_ID, drm_state
from rendering import frame_rate, configure_renderer
from gpu import TextureFrame

ROOT = Path(__file__).resolve().parents[1]
APP_ID = 'io.github.amzml.AmazonMusic'
parser = argparse.ArgumentParser()
parser.add_argument('--preview', action='store_true')
parser.add_argument('--smoke-test', action='store_true')
parser.add_argument('--diagnostics', action='store_true')
parser.add_argument('--enable-gpu', action='store_true')
parser.add_argument('--disable-gpu', action='store_true')
parser.add_argument('--check-web', action='store_true', help='Temporary-profile catalogue/DRM diagnostic, then exit')
parser.add_argument('--diagnostic-profile', help='Reuse an owned private temporary diagnostic profile')
parser.add_argument('--keep-diagnostic-profile', action='store_true', help='Keep the temporary profile for a second DRM check')
options = parser.parse_args()
TEST = options.preview or options.smoke_test
DIAGNOSTIC = options.diagnostics or options.check_web
if (options.diagnostic_profile or options.keep_diagnostic_profile) and not DIAGNOSTIC:
    parser.error('Diagnostic profile options require --diagnostics or --check-web')

class MusicApp(Adw.Application):
    def __init__(self):
        super().__init__(application_id=APP_ID if not TEST and not DIAGNOSTIC else APP_ID + '.Test',
                         flags=Gio.ApplicationFlags.NON_UNIQUE if TEST or DIAGNOSTIC else Gio.ApplicationFlags.DEFAULT_FLAGS)
        self.window = self.engine = self.mpris = self.appearance = None
        self.closing = self.restarting = False
        self.pump_id = 0
        self.frame_count = 0
        self.frame_tick_id = 0
        self.last_present = 0
        self.frame_rate = 0
        self.frame_has_content = False
        self.texture = None
        self.current_url = ''
        self.ready = False
        self.error = ''
        self.drm = {'ready': False, 'error': 'Verificando Widevine…'}
        self.media = {'available': False, 'paused': True, 'title': ''}
        self.system_theme = 'system'
        self.zoom_level = 0
        self.view_size = None
        self.load_deadline = 0
        self.test_reports = []
        self.preferences = None
        self.tray_host = None
        self.tray_available = False
        self.background = False
        if options.diagnostic_profile:
            candidate=Path(options.diagnostic_profile).absolute()
            info=candidate.lstat()
            if (candidate.parent != Path(tempfile.gettempdir()) or not candidate.name.startswith('amzml-electron-')
                    or not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077):
                parser.error('Invalid diagnostic profile: expected an owned private temporary directory')
            self.test_profile=candidate
        else: self.test_profile = Path(tempfile.mkdtemp(prefix='amzml-electron-')) if TEST or DIAGNOSTIC else None
        self.components = {}
        self.component_update = None
        self.update_requested = False
        self.component_restart = False
        self.last_poll = 0
        self.last_drm_probe = 0
        self.pointer = (0,0)
        self.config_dir = self.test_profile or Path(GLib.get_user_config_dir()) / 'Amazon Music Linux'
        self.cache_dir = (self.test_profile / 'electron' if self.test_profile else
                          Path(GLib.get_user_data_dir()) / 'amazon-music-linux/electron')
        for path in (self.config_dir, self.cache_dir): path.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.startup_cdm_versions = set()
        for manifest in (self.cache_dir / 'WidevineCdm').glob('*/manifest.json'):
            try: self.startup_cdm_versions.add(json.loads(manifest.read_text())['version'])
            except (OSError,ValueError,KeyError): pass
        self.settings_path = self.config_dir / 'settings.json'
        try: self.settings = clean_settings(json.loads(self.settings_path.read_text()))
        except (OSError, ValueError): self.settings = clean_settings({})
        self.gpu = not options.disable_gpu and (options.enable_gpu or self.settings['hardwareAcceleration'])
        # DMA-BUFs present efficiently through Vulkan. Memory bitmaps perform
        # better through GL on the tested driver. Respect explicit overrides.
        self.auto_renderer=configure_renderer(os.environ,self.gpu,hasattr(Gdk,'DmabufTextureBuilder'))
        os.environ['AMZML_GPU'] = '1' if self.gpu else '0'
        os.environ.setdefault('AMZML_SHARED_TEXTURE','1' if hasattr(Gdk,'DmabufTextureBuilder') and (ROOT/'electron/gpu-bridge.node').is_file() else '0')
        os.environ['AMZML_TEST'] = '1' if TEST else '0'
        os.environ['AMZML_X11'] = '1' if os.environ.get('GDK_BACKEND', '').split(',')[0] == 'x11' else '0'
        for variable in ('CHROME_DESKTOP', 'ELECTRON_RUN_AS_NODE'): os.environ.pop(variable, None)
        self.connect('activate', self.activate_app)
        self.connect('shutdown', self.cleanup)

    def action(self, name, callback, shortcuts=()):
        action = Gio.SimpleAction.new(name, None)
        action.connect('activate', lambda *_: callback())
        self.add_action(action)
        if shortcuts: self.set_accels_for_action('app.' + name, shortcuts)

    def activate_app(self, _app):
        if self.window: self.command('open'); return
        self.window = Adw.ApplicationWindow(application=self, title='Amazon Music Linux',
                                            default_width=1280, default_height=860)
        self.window.set_icon_name(APP_ID)
        self.window.set_size_request(720, 480)
        self.window.connect('close-request', self.close_request)
        self.toolbar = Adw.ToolbarView()
        self.header = Adw.HeaderBar()
        self.header.set_title_widget(Adw.WindowTitle(title='Amazon Music', subtitle=''))
        for icon, label, command in [('go-home-symbolic', 'Início', self.home),
                                     ('view-refresh-symbolic', 'Recarregar', self.reload),
                                     ('media-playback-start-symbolic', 'Reproduzir ou pausar', lambda: self.command('toggle'))]:
            button = Gtk.Button(icon_name=icon, tooltip_text=label)
            button.connect('clicked', lambda _, callback=command: callback())
            self.header.pack_start(button)
            if icon.startswith('media-'): self.play_button = button; button.set_sensitive(False)
        self.spinner = Gtk.Spinner()
        self.header.pack_end(self.spinner)
        menu = Gio.Menu()
        for label, action in [('Preferências', 'preferences'), ('Ampliar', 'zoom-in'),
                              ('Reduzir', 'zoom-out'), ('Zoom padrão', 'zoom-reset'),
                              ('Ir para segundo plano', 'hide'), ('Sobre', 'about'), ('Sair', 'quit')]: menu.append(label, 'app.' + action)
        self.header.pack_end(Gtk.MenuButton(icon_name='open-menu-symbolic', menu_model=menu, tooltip_text='Menu'))
        self.toolbar.add_top_bar(self.header)
        self.drm_banner = Adw.Banner(title='Widevine foi instalado. Reinicie para ativar a reprodução protegida.',
                                     button_label='Reiniciar', revealed=False)
        self.drm_banner.connect('button-clicked',lambda _: self.restart())
        self.toolbar.add_top_bar(self.drm_banner)
        self.stack = Gtk.Stack(vexpand=True, hexpand=True)
        self.overlay = Gtk.Overlay(vexpand=True, hexpand=True, focusable=True)
        self.picture = Gtk.Picture(hexpand=True, vexpand=True, can_shrink=True,
                                   content_fit=Gtk.ContentFit.FILL, alternative_text='Player do Amazon Music')
        self.overlay.set_child(self.picture)
        self.popup = Gtk.Picture(halign=Gtk.Align.START, valign=Gtk.Align.START,
                                 content_fit=Gtk.ContentFit.FILL, visible=False)
        self.overlay.add_overlay(self.popup)
        self.stack.add_named(self.overlay, 'player')
        self.status_page = Adw.StatusPage(title='Carregando Amazon Music',
                                         description='Preparando o player…', icon_name=APP_ID)
        self.retry_button = Gtk.Button(label='Tentar novamente', halign=Gtk.Align.CENTER)
        self.retry_button.add_css_class('suggested-action')
        self.retry_button.connect('clicked', lambda _: self.home())
        self.retry_button.set_visible(False)
        self.status_page.set_child(self.retry_button)
        self.stack.add_named(self.status_page, 'status')
        self.toolbar.set_content(self.stack)
        self.window.set_content(self.toolbar)
        self.install_input()
        self.action('preferences', self.show_preferences, ['<Control>comma'])
        self.action('home', self.home, ['<Alt>Home'])
        self.action('reload', self.reload, ['<Control>r'])
        self.action('quit', self.quit_app, ['<Control>q'])
        self.action('hide', self.hide_to_background)
        self.lookup_action('hide').set_enabled(self.settings['background'])
        self.action('about', self.about)
        self.action('zoom-in', lambda: self.zoom(0.5), ['<Control>plus', '<Control>equal'])
        self.action('zoom-out', lambda: self.zoom(-0.5), ['<Control>minus'])
        self.action('zoom-reset', lambda: self.zoom(-self.zoom_level), ['<Control>0'])
        self.appearance = Appearance(self.system_changed)
        self.apply_theme()
        self.mpris = Mpris(self.command, 'org.mpris.MediaPlayer2.amazon_music_linux.test'+str(os.getpid()) if TEST or DIAGNOSTIC else 'org.mpris.MediaPlayer2.amazon_music_linux',self.config_dir/'artwork')
        self.tray_host = TrayHost(self.tray_changed)
        self.window.present()
        self.hold()
        GLib.idle_add(self.start_engine)

    def start_engine(self):
        try:
            runtime = ROOT / 'runtime'
            if not runtime.exists(): runtime = ROOT / '.cache/runtime/electron'
            os.environ['AMZML_SCALE'] = str(self.window.get_scale_factor())
            self.engine = Electron(runtime, self.cache_dir, self.home_url(), self.paint, self.event, lambda: GLib.idle_add(self.schedule_frame))
            self.engine.mute(self.settings['mute'])
            self.sync_frame_rate()
            self.sync_tray()
            self.apply_theme()
            self.load_deadline = time.monotonic() + 40
            self.pump_id = GLib.timeout_add(50, self.pump)
            if options.diagnostics: print('AMZML_ELECTRON_DIAGNOSTICS', json.dumps({'profile':str(self.cache_dir),'engine':'Electron'}), flush=True)
            if options.smoke_test:
                from smoke import Smoke
                self.smoke = Smoke(self)
                GLib.timeout_add(150, self.smoke.step)
            if options.check_web:
                GLib.timeout_add_seconds(35, self.check_web)
        except Exception as error:
            traceback.print_exc(); self.show_error(str(error)); self.release()
        return GLib.SOURCE_REMOVE

    def home_url(self):
        return (ROOT / 'tests/player_fixture.html').as_uri() if TEST else REGIONS[self.settings['region']][1]

    def paint(self, kind, width, height, pointer):
        if self.closing:
            if isinstance(pointer,TextureFrame):pointer.release()
            return
        try:
            if isinstance(pointer,TextureFrame):
                try:texture=pointer.build(self.window.get_display())
                except Exception:
                    pointer.release();self.engine.send('texture-fallback');return
            else:
                data = GLib.Bytes.new(pointer)
                texture = Gdk.MemoryTexture.new(width, height, Gdk.MemoryFormat.B8G8R8A8_PREMULTIPLIED, data, width*4)
            if kind == 0:
                self.texture = texture; self.picture.set_paintable(texture); self.frame_count += 1
                if not self.frame_has_content:
                    pixels=(Gdk.TextureDownloader.new(texture).download_bytes()[0].get_data()
                            if isinstance(pointer,TextureFrame) else pointer)
                    step = max(4, len(pixels)//4096//4*4)
                    self.frame_has_content = len({pixels[i:i+4] for i in range(0,len(pixels),step)})>1
                    if self.frame_has_content and isinstance(pointer,TextureFrame):self.engine.send('texture-ready')
            else: self.popup.set_paintable(texture)
        except Exception:
            traceback.print_exc()

    def event(self, kind, raw):
        text = raw.decode('utf-8', errors='replace')
        try:
            if kind == 8:
                allowed = amazon_url(text) or text == 'about:blank' or (TEST and text == self.home_url())
                if not allowed and https_url(text): GLib.idle_add(self.external, text)
                return 0 if allowed else 1
            if kind == 12: return 0 if music_url(text) else 1
            if kind == 4:
                GLib.idle_add(self.route_popup, text)
            elif kind == 2:
                self.current_url = text
                self.ready = amazon_url(text) or (TEST and text == self.home_url())
                if self.ready:
                    self.error = ''; self.stack.set_visible_child_name('player'); self.load_deadline = 0
                    GLib.idle_add(self.inject_observer)
            elif kind == 3: GLib.idle_add(self.show_error, 'Não foi possível carregar o player: ' + text[:200])
            elif kind == 5:
                state = clean_media(json.loads(text))
                if state and (music_url(self.current_url) or TEST):
                    changed = state != self.media
                    self.media = state
                    if changed:
                        self.sync_tray()
                        self.mpris.update({'settings':self.settings,'media':self.media})
            elif kind == 6:
                report = json.loads(text)
                if type(report.get('ready')) is bool:
                    self.drm = {'ready':report['ready'], 'error':str(report.get('error', ''))[:100]}
            elif kind == 9: self.popup.set_visible(text == '1')
            elif kind == 10:
                x,y,w,h = [int(n) for n in text.split(',')]
                self.popup.set_margin_start(max(0,x)); self.popup.set_margin_top(max(0,y))
                self.popup.set_size_request(w,h)
            elif kind == 11 and options.smoke_test: self.test_reports.append(json.loads(text))
            elif kind == 14:
                component = json.loads(text)
                self.components[component['id']] = component
            elif kind == 15: self.component_update = int(text)
            elif kind == 17 and text in ('open','toggle','mute','quit'):
                GLib.idle_add(self.tray_command, text)
        except Exception: traceback.print_exc()
        return 0

    def inject_observer(self):
        # The isolated Electron preload observes media and probes EME.
        pass
        return GLib.SOURCE_REMOVE

    def external(self, url):
        if https_url(url):
            launcher = Gtk.UriLauncher.new(url)
            launcher.launch(self.window, None, None, None)
        return GLib.SOURCE_REMOVE

    def route_popup(self, url):
        if amazon_url(url): self.engine.navigate(url)
        else: self.external(url)
        return GLib.SOURCE_REMOVE

    def pump(self):
        if not self.engine: return GLib.SOURCE_REMOVE
        self.engine.pump(present=False)
        # The picture has no tick while the loading page is visible, and
        # compositors can suspend ticks in covered windows. Deliver a startup
        # frame (or refresh at 10 fps) until the widget's frame clock resumes.
        now=time.monotonic()
        if not self.closing and not self.background and now-self.last_present>0.1:
            self.engine.present_frame(); self.last_present=now
        if self.closing:
            if self.engine.closed(): self.engine.shutdown(); self.engine = None; self.release(); self.quit(); return GLib.SOURCE_REMOVE
            return GLib.SOURCE_CONTINUE
        w,h = self.overlay.get_width(), self.overlay.get_height()
        factor = self.window.get_scale_factor()
        if w > 0 and h > 0 and (w,h,factor) != self.view_size:
            self.engine.resize(w,h,factor); self.view_size=(w,h,factor)
            self.sync_frame_rate()
        if self.engine.closed():
            self.engine.shutdown(); self.pump_id = 0
            return GLib.SOURCE_REMOVE
        if self.load_deadline and time.monotonic() > self.load_deadline:
            self.show_error('O Amazon Music demorou para responder. Verifique a conexão e tente novamente.')
        controls = (not self.ready and not self.error, self.media['available'], self.media['paused'])
        if controls != getattr(self, 'last_controls', None):
            self.last_controls = controls
            self.spinner.set_spinning(controls[0])
            self.play_button.set_sensitive(controls[1])
            self.play_button.set_icon_name('media-playback-start-symbolic' if controls[2] else 'media-playback-pause-symbolic')
        now=time.monotonic()
        if now-self.last_poll>1:
            self.last_poll=now
            self.sync_frame_rate()
            self.mpris.update({'settings':self.settings, 'media':self.media})
            self.engine.components()
            self.sync_tray()
            component=self.components.get(WIDEVINE_ID)
            if not TEST and not self.update_requested and component and component['version']=='0.0.0.0':
                self.update_widevine()
            self.component_restart=drm_state(component,self.drm['ready'],self.startup_cdm_versions)=='restart'
            self.drm_banner.set_revealed(self.component_restart)
            self.update_drm_label()
        if not self.drm['ready'] and self.ready and now-self.last_drm_probe>10:
            self.last_drm_probe=now; self.inject_observer()
        return GLib.SOURCE_CONTINUE

    def schedule_frame(self):
        self.frame_active_until = time.monotonic() + 0.025
        if self.engine and not self.closing and not self.background and not self.frame_tick_id:
            self.frame_tick_id = self.picture.add_tick_callback(self.present_frame)
        return GLib.SOURCE_REMOVE

    def present_frame(self, _widget, _clock):
        self.last_present=time.monotonic()
        if self.engine and not self.closing and not self.background:
            self.engine.present_frame()
            # Keep the clock running across a stream of frames. Re-registering
            # for each frame costs an extra vsync and halves presentation rate.
            if time.monotonic() < getattr(self, 'frame_active_until', 0):
                return GLib.SOURCE_CONTINUE
        self.frame_tick_id = 0
        return GLib.SOURCE_REMOVE

    def sync_frame_rate(self):
        if not self.engine or not self.window: return
        surface=self.window.get_surface()
        monitor=self.window.get_display().get_monitor_at_surface(surface) if surface else None
        millihertz=monitor.get_refresh_rate() if monitor else 0
        clock=self.window.get_frame_clock()
        interval=clock.get_refresh_info(clock.get_frame_time())[0] if clock else 0
        target=frame_rate(millihertz,interval)
        if target!=self.frame_rate:
            self.frame_rate=target; self.engine.set_frame_rate(target)

    def show_error(self, text):
        if self.background: self.command('open')
        self.error = text; self.ready = False; self.load_deadline = 0
        self.status_page.set_title('Não foi possível abrir o player')
        self.status_page.set_description(text); self.retry_button.set_visible(True)
        self.stack.set_visible_child_name('status')
        return GLib.SOURCE_REMOVE

    def home(self):
        if not self.engine or self.closing: return
        if self.engine.closed():
            self.engine.shutdown(); self.engine = None
            self.start_engine(); return
        self.ready = False; self.error = ''; self.load_deadline = time.monotonic() + 40
        self.media = {'available':False,'paused':True,'title':''}
        self.status_page.set_title('Carregando Amazon Music'); self.status_page.set_description('Conectando ao serviço…')
        self.retry_button.set_visible(False); self.stack.set_visible_child_name('status')
        self.engine.navigate(self.home_url())

    def reload(self):
        if self.engine: self.home()

    def command(self, command):
        if command == 'open':
            self.background = False
            if self.engine: self.engine.foreground(True)
            self.window.present()
        elif command == 'quit': self.quit_app()
        elif command == 'mute': self.save(mute=not self.settings['mute'])
        elif self.engine and self.media['available'] and command in ('play','pause','toggle','next','previous'):
            self.engine.media_command(command)

    def save(self, **changes):
        self.settings = clean_settings(dict(self.settings, **changes))
        temporary = self.settings_path.with_suffix('.tmp')
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(descriptor,'w') as stream: json.dump(self.settings,stream,indent=2)
        temporary.replace(self.settings_path)
        self.apply_theme()
        if self.engine: self.engine.mute(self.settings['mute'])
        self.sync_tray()
        action = self.lookup_action('hide')
        if action: action.set_enabled(self.settings['background'])
        if self.background and not self.settings['background']: self.command('open')

    def tray_command(self, command):
        if not self.closing: self.command(command)
        return GLib.SOURCE_REMOVE

    def tray_changed(self, available):
        self.tray_available = available
        self.update_background_label()

    def sync_tray(self):
        if self.engine:
            self.engine.tray(self.settings['background'], self.media, self.settings['mute'])
        self.update_background_label()

    def update_background_label(self):
        if not self.preferences or not hasattr(self, 'background_row'): return
        if self.tray_available:
            text = 'Ao fechar a janela, a reprodução continua. Use o ícone na barra superior para abrir ou sair.'
        else:
            text = 'No GNOME, o ícone na barra requer a extensão AppIndicator. Sem ela, reabra pelo lançador ou pelo player de mídia.'
        if self.engine and self.engine.state.get('trayError'):
            text = 'Não foi possível criar o ícone na barra. Reabra pelo lançador ou pelo player de mídia.'
        self.background_row.set_subtitle(text)

    def hide_to_background(self):
        if self.closing or not self.settings['background']: return
        self.background = True
        self.window.set_visible(False)
        if self.engine: self.engine.foreground(False)

    def system_changed(self, theme):
        self.system_theme = theme; self.apply_theme()

    def apply_theme(self):
        resolved = self.system_theme if self.settings['theme']=='system' else self.settings['theme']
        scheme = {'dark':Adw.ColorScheme.FORCE_DARK, 'light':Adw.ColorScheme.FORCE_LIGHT}.get(resolved, Adw.ColorScheme.DEFAULT)
        Adw.StyleManager.get_default().set_color_scheme(scheme)
        if self.engine: self.engine.theme(resolved)

    def zoom(self, amount):
        self.zoom_level = max(-2,min(3,self.zoom_level+amount))
        if self.engine: self.engine.zoom(self.zoom_level)

    def update_drm_label(self):
        if self.preferences:
            status=drm_state(self.components.get(WIDEVINE_ID),self.drm['ready'],self.startup_cdm_versions)
            messages={'ready':'Widevine disponível', 'preparing':'Baixando e instalando o Widevine…',
                      'restart':'Widevine instalado nesta execução. Reinicie para ativá-lo.',
                      'unavailable':'Widevine indisponível: '+self.drm.get('error','')}
            self.drm_row.set_subtitle(messages[status]+(' Falha ao verificar CDM: '+str(self.component_update) if self.component_update else ''))
            features = self.engine.state.get('features', {}) if self.engine else {}
            accelerated = features.get('gpu_compositing') == 'enabled'
            performance = ('Aceleração de hardware ativa.' if accelerated else 'Aceleração solicitada; o Chromium está usando renderização por software.') if self.gpu else 'Renderização por software.'
            self.gpu_row.set_subtitle(performance +
                (' Reinicie para aplicar a alteração.' if self.settings['hardwareAcceleration'] != self.gpu else ''))

    def show_preferences(self):
        if self.preferences: self.preferences.present(self.window); return
        self.preferences = Adw.PreferencesDialog(title='Preferências', content_width=540, content_height=650)
        self.preferences.connect('closed', lambda _: setattr(self,'preferences',None))
        page = Adw.PreferencesPage(title='Geral', icon_name='preferences-system-symbolic')
        general = Adw.PreferencesGroup(title='Aparência e serviço')
        theme = Adw.ComboRow(title='Aparência', model=Gtk.StringList.new(['Sistema','Clara','Escura']))
        theme.set_selected(['system','light','dark'].index(self.settings['theme']))
        theme.connect('notify::selected', lambda row,_: self.save(theme=['system','light','dark'][row.get_selected()]))
        self.theme_row = theme; general.add(theme)
        region = Adw.ComboRow(title='Região do Amazon Music', model=Gtk.StringList.new([v[0] for v in REGIONS.values()]))
        region.set_selected(list(REGIONS).index(self.settings['region']))
        region.connect('notify::selected', lambda row,_: (self.save(region=list(REGIONS)[row.get_selected()]), self.home()))
        general.add(region)
        mute = Adw.SwitchRow(title='Silenciar áudio', active=self.settings['mute'])
        mute.connect('notify::active',lambda row,_: self.save(mute=row.get_active()))
        general.add(mute); page.add(general)
        desktop = Adw.PreferencesGroup(title='Integração com o desktop')
        self.background_row = Adw.SwitchRow(title='Executar em segundo plano', active=self.settings['background'])
        self.background_row.connect('notify::active', lambda row,_: self.save(background=row.get_active()))
        desktop.add(self.background_row)
        desktop.add(Adw.ActionRow(title='Encerrar o aplicativo', subtitle='Use Sair no menu da janela ou do ícone na barra. Ctrl+Q também encerra.'))
        page.add(desktop)
        self.update_background_label()
        performance = Adw.PreferencesGroup(title='Desempenho')
        self.gpu_row = Adw.SwitchRow(title='Aceleração de hardware', active=self.settings['hardwareAcceleration'])
        self.gpu_row.connect('notify::active',lambda row,_: self.save(hardwareAcceleration=row.get_active()))
        performance.add(self.gpu_row)
        restart = Adw.ActionRow(title='Aplicar alterações',subtitle='Reiniciar o aplicativo')
        button = Gtk.Button(label='Reiniciar',valign=Gtk.Align.CENTER)
        button.connect('clicked',lambda _: self.restart())
        self.restart_button = button
        restart.add_suffix(button); performance.add(restart); page.add(performance)
        playback = Adw.PreferencesGroup(title='Reprodução')
        self.drm_row = Adw.ActionRow(title='Widevine DRM'); playback.add(self.drm_row)
        update = Gtk.Button(label='Verificar CDM',valign=Gtk.Align.CENTER)
        update.connect('clicked',lambda _: self.update_widevine())
        self.drm_row.add_suffix(update)
        playback.add(Adw.ActionRow(title='Qualidade de áudio',subtitle='Use a maior qualidade disponível no player da Amazon. HD/Ultra HD dependem do serviço; saída bit-perfect não está implementada.'))
        page.add(playback); self.preferences.add(page)
        self.update_drm_label(); self.preferences.present(self.window)

    def restart(self):
        if TEST: return
        self.restarting = True; self.close_request(self.window)

    def update_widevine(self):
        if self.engine and not TEST:
            self.update_requested = True
            self.component_update = None
            self.engine.update_component(WIDEVINE_ID.encode())

    def check_web(self):
        print('ELECTRON WEB CHECK',json.dumps({'ready':self.ready,'frames':self.frame_count,
              'drm':self.drm,'component':self.components.get(WIDEVINE_ID),
              'updateResult':self.component_update,'restart':self.component_restart,
              'profile':str(self.test_profile),'startupVersions':sorted(self.startup_cdm_versions),'error':self.error,'backend':self.engine.state}),flush=True)
        capture=os.environ.get('AMZML_WEB_CAPTURE')
        if capture and self.ready and self.texture: self.texture.save_to_png(capture)
        self.test_exit=0 if self.ready and self.frame_count else 1
        self.quit_app()
        return GLib.SOURCE_REMOVE

    def about(self):
        dialog = Adw.AboutDialog(application_name='Amazon Music Linux', application_icon=APP_ID,
            version='0.4.3', developer_name='Amazon Music Linux contributors',
            comments='Cliente independente com GTK4, libadwaita e Electron. Inspirado na arquitetura do Karere. Não é um aplicativo oficial da Amazon.',
            license_type=Gtk.License.MIT_X11)
        dialog.present(self.window)

    def close_request(self, _window):
        if self.settings['background'] and not self.restarting and not self.closing:
            self.hide_to_background()
            return True
        return self.quit_app()

    def quit_app(self):
        if self.closing: return True
        self.closing = True; self.window.set_visible(False)
        if self.engine: self.engine.close()
        else: self.quit()
        return True

    def cleanup(self, _app):
        if self.tray_host: self.tray_host.close()
        if self.appearance: self.appearance.close()
        if self.mpris: self.mpris.close()
        if self.test_profile and not options.keep_diagnostic_profile and not self.restarting:
            shutil.rmtree(self.test_profile,ignore_errors=True)
        if self.restarting:
            if self.auto_renderer:os.environ.pop('GSK_RENDERER',None)
            args=[arg for arg in sys.argv if arg not in ('--enable-gpu','--disable-gpu')]
            if self.test_profile and not options.diagnostic_profile:
                args.extend(['--diagnostic-profile',str(self.test_profile)])
            os.execv('/usr/bin/python3',['/usr/bin/python3',*args])

    @staticmethod
    def modifiers(state):
        result=0
        for gdk,bit in [(Gdk.ModifierType.SHIFT_MASK,2),(Gdk.ModifierType.CONTROL_MASK,4),
                        (Gdk.ModifierType.ALT_MASK,8),(Gdk.ModifierType.BUTTON1_MASK,16),
                        (Gdk.ModifierType.BUTTON2_MASK,32),(Gdk.ModifierType.BUTTON3_MASK,64),
                        (Gdk.ModifierType.SUPER_MASK,128)]:
            if state & gdk: result |= bit
        return result

    def mouse(self,kind,x,y,button=0,up=0,count=1,state=0,dx=0,dy=0,precise=False):
        if self.engine and not self.closing:
            if not all(math.isfinite(v) for v in (x,y,dx,dy)): return
            if kind==0: self.pointer=(x,y)
            self.engine.mouse(kind,x,y,button,up,count,self.modifiers(state),dx,dy,precise=precise)

    def install_input(self):
        motion = Gtk.EventControllerMotion()
        motion.connect('motion',lambda c,x,y: self.mouse(0,x,y,state=c.get_current_event_state()))
        motion.connect('leave',lambda c: self.mouse(0,0,0,up=1))
        self.overlay.add_controller(motion)
        click = Gtk.GestureClick(button=0)
        def clicked(c,count,x,y,up):
            self.overlay.grab_focus()
            if self.engine: self.engine.focus(1)
            self.mouse(1,x,y,{1:0,2:1,3:2}.get(c.get_current_button(),0),up,count,c.get_current_event_state())
        click.connect('pressed',lambda c,n,x,y: clicked(c,n,x,y,0))
        click.connect('released',lambda c,n,x,y: clicked(c,n,x,y,1))
        self.overlay.add_controller(click)
        scroll = Gtk.EventControllerScroll(flags=Gtk.EventControllerScrollFlags.BOTH_AXES)
        def scrolled(c,dx,dy):
            # Wayland scroll events may have no coordinates (NaN). Use the
            # view-relative pointer position from motion, not surface coords.
            # Touchpads report surface pixels; multiplying those by wheel
            # distance made small gestures jump across the page.
            distance=40 if c.get_unit()==Gdk.ScrollUnit.WHEEL else 1
            self.mouse(2,*self.pointer,state=c.get_current_event_state(),dx=-dx*distance,dy=-dy*distance,
                       precise=c.get_unit()==Gdk.ScrollUnit.SURFACE)
            return True
        scroll.connect('scroll',scrolled); self.overlay.add_controller(scroll)
        self.im = Gtk.IMMulticontext(); self.im.set_client_widget(self.overlay)
        self.im.connect('commit',lambda _,text: self.commit(text))
        keys = Gtk.EventControllerKey(); keys.set_im_context(self.im)
        keys.connect('key-pressed', self.key_pressed)
        keys.connect('key-released', lambda c,key,code,state: self.key_event(2,key,code,state))
        self.overlay.add_controller(keys)
        focus = Gtk.EventControllerFocus()
        focus.connect('enter',lambda _: self.engine and self.engine.focus(1))
        focus.connect('leave',lambda _: self.engine and self.engine.focus(0))
        self.overlay.add_controller(focus)

    def commit(self,text):
        if self.engine:
            self.engine.insert_text(text)

    def key_event(self,kind,key,code,state):
        special={'BackSpace':8,'Tab':9,'Return':13,'Escape':27,'space':32,'Page_Up':33,'Page_Down':34,
                 'End':35,'Home':36,'Left':37,'Up':38,'Right':39,'Down':40,'Insert':45,'Delete':46}
        name=Gdk.keyval_name(key)
        text=chr(Gdk.keyval_to_unicode(key)) if Gdk.keyval_to_unicode(key) else ''
        vk=special.get(name,ord(text.upper()) if len(text.upper())==1 else 0)
        if self.engine: self.engine.key(kind,vk,code,0,self.modifiers(state))

    def key_pressed(self,controller,key,code,state):
        if state & Gdk.ModifierType.CONTROL_MASK:
            name=(Gdk.keyval_name(key) or '').lower()
            edits={'c':'copy','x':'cut','v':'paste','a':'select_all'}
            if name in edits:
                # Electron uses the real platform clipboard via native edit commands.
                if self.engine: self.engine.edit(edits[name].encode())
                return True
            if name in ('q','r','comma','plus','equal','minus','0'): return False
        self.key_event(0,key,code,state)
        if Gdk.keyval_name(key) in ('Return','Tab') and self.engine:
            self.engine.key(3,0,0,13 if Gdk.keyval_name(key)=='Return' else 9,self.modifiers(state))
        # GTK's IM context handles text composition; Enter/Tab remain key events.
        return True

if __name__ == '__main__':
    app=MusicApp()
    code=app.run([])
    sys.exit(getattr(app,'test_exit',code))
