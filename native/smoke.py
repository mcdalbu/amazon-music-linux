"""Integration test with real GTK widgets, Electron pixels and Chromium input events."""
import json
import os
from pathlib import Path
import time
from gi.repository import Adw, Gdk, Graphene, Gtk, GLib

class Smoke:
    def __init__(self,app):
        self.app=app; self.phase=0; self.deadline=time.monotonic()+45; self.started=0
        self.paintable=Gtk.WidgetPaintable.new(app.toolbar)

    def capture(self,name):
        destination=os.environ.get('AMZML_TEST_CAPTURE')
        if not destination: return
        app=self.app
        snapshot=Gtk.Snapshot.new()
        found,color=app.window.get_style_context().lookup_color('window_bg_color')
        assert found, 'Native libadwaita window background is available'
        rect=Graphene.Rect(); rect.init(0,0,app.toolbar.get_width(),app.toolbar.get_height())
        snapshot.append_color(color,rect)
        self.paintable.snapshot(snapshot,app.toolbar.get_width(),app.toolbar.get_height())
        node=snapshot.to_node()
        texture=app.window.get_renderer().render_texture(node,None)
        target=Path(destination).with_name(Path(destination).stem+'-'+name+'.png')
        texture.save_to_png(str(target))

    def step(self):
        app=self.app
        try:
            if time.monotonic()>self.deadline: raise AssertionError(f'Timeout in native Electron phase {self.phase}: {app.error}; ready={app.ready}, content={app.frame_has_content}, frames={app.frame_count}, state={app.engine.state}')
            if self.phase==0:
                if not app.ready or not app.frame_has_content: return True
                assert isinstance(app.window,Adw.ApplicationWindow)
                assert len(app.get_windows())==1
                assert app.engine.window_handle()==0, 'Electron must not create a visible window'
                assert app.engine.state['sandbox'] and app.engine.state['offscreen']
                if app.engine.state.get('targetFrameRate')!=app.frame_rate:return True
                if app.view_size is None: return True
                if app.texture.get_width()!=app.view_size[0]*app.view_size[2]: return True
                assert app.texture.get_height()==app.view_size[1]*app.view_size[2], 'Render at physical pixel resolution'
                assert app.engine.state.get('displayScale')==app.view_size[2]
                app.engine.execute("document.title=''")
                app.texture.save_to_png(str(app.test_profile/'player.png'))
                app.save(theme='dark')
                self.phase=1; self.started=time.monotonic()
            elif self.phase==1:
                if time.monotonic()-self.started<0.5: return True
                assert Adw.StyleManager.get_default().get_dark()
                self.capture('dark')
                app.save(theme='light'); self.phase=2; self.started=time.monotonic()
            elif self.phase==2:
                if time.monotonic()-self.started<0.5: return True
                assert not Adw.StyleManager.get_default().get_dark()
                self.capture('light')
                app.show_preferences()
                app.theme_row.set_selected(2)
                assert app.settings['theme']=='dark'
                assert Adw.StyleManager.get_default().get_dark()
                app.gpu_row.set_active(not app.gpu)
                assert json.loads(app.settings_path.read_text())['hardwareAcceleration']==(not app.gpu)
                app.save(mute=True); app.save(mute=False)
                assert len(app.get_windows())==1, 'Preferences must be an in-window dialog'
                app.preferences.close(); app.save(theme='system')
                app.system_changed('light'); assert not Adw.StyleManager.get_default().get_dark()
                app.system_changed('dark'); assert Adw.StyleManager.get_default().get_dark()
                self.phase=3; self.started=time.monotonic()
            elif self.phase==3:
                if time.monotonic()-self.started<0.5: return True
                app.window.present()
                app.engine.execute('scrollTo(0,0)')
                self.phase=30; self.started=time.monotonic()
            elif self.phase==30:
                if time.monotonic()-self.started<0.5: return True
                app.overlay.grab_focus(); app.engine.focus(1)
                app.mouse(1,80,130,up=0); app.mouse(1,80,130,up=1)
                app.im.emit('commit','Olá Amazon')
                app.mouse(1,100,190,up=0); app.mouse(1,100,190,up=1)
                self.phase=4; self.started=time.monotonic()
            elif self.phase==4:
                if time.monotonic()-self.started<0.3: return True
                app.engine.execute('report()')
                self.phase=5
            elif self.phase==5:
                if not app.test_reports: return True
                report=app.test_reports[-1]
                assert report['text']=='Olá Amazon',report
                assert report['clicks']==1,report
                assert report['width']==app.overlay.get_width(),report
                assert report['dpr']==app.view_size[2],report
                app.mouse(1,350,190,up=0);app.mouse(1,350,190,up=1)
                self.phase=31;self.started=time.monotonic()
            elif self.phase==31:
                if time.monotonic()-self.started<0.3:return True
                app.engine.key(0,40,0,0,0);app.engine.key(2,40,0,0,0)
                app.engine.key(0,13,0,0,0);app.engine.key(2,13,0,0,0)
                self.phase=32;self.started=time.monotonic()
            elif self.phase==32:
                if time.monotonic()-self.started<0.3:return True
                app.test_reports.clear();app.engine.execute('report()');self.phase=33
            elif self.phase==33:
                if not app.test_reports:return True
                assert app.test_reports[-1]['quality']=='Alta',app.test_reports
                assert app.texture.get_width()==app.view_size[0]*app.view_size[2]
                app.mouse(2,80,240,dy=-200)
                self.phase=6; self.started=time.monotonic()
            elif self.phase==6:
                if time.monotonic()-self.started<0.5: return True
                app.test_reports.clear(); app.engine.execute('report()'); self.phase=7
            elif self.phase==7:
                if not app.test_reports: return True
                assert app.test_reports[-1]['scroll']>0,app.test_reports
                app.show_error('Erro de teste')
                assert app.stack.get_visible_child_name()=='status'
                app.retry_button.emit('clicked'); self.phase=8
            elif self.phase==8:
                if not app.ready: return True
                app.window.set_default_size(1000,700)
                self.phase=9; self.started=time.monotonic()
            elif self.phase==9:
                if time.monotonic()-self.started<1: return True
                if app.view_size[0]!=app.overlay.get_width(): return True
                if app.texture.get_width()!=app.view_size[0]*app.view_size[2]: return True
                assert len(app.get_windows())==1
                app.engine.resize(app.view_size[0],app.view_size[1],1)
                self.phase=10; self.started=time.monotonic()
            elif self.phase==10:
                if app.texture.get_width()!=app.view_size[0]: return True
                app.engine.resize(*app.view_size)
                self.phase=11
            elif self.phase==11:
                if app.texture.get_width()!=app.view_size[0]*app.view_size[2]: return True
                app.zoom(1); self.phase=12; self.started=time.monotonic()
            elif self.phase==12:
                if time.monotonic()-self.started<0.5: return True
                app.test_reports.clear(); app.engine.execute('report()'); self.phase=13
            elif self.phase==13:
                if not app.test_reports: return True
                report=app.test_reports[-1]
                assert abs(report['width']-app.overlay.get_width()/1.2)<2,report
                assert abs(report['dpr']-app.view_size[2]*1.2)<0.01,report
                app.zoom(-1)
                app.engine.execute("detachedAudio.play()")
                self.phase=14
            elif self.phase==14:
                if not app.media['available'] or app.media['paused']: return True
                assert app.play_button.get_sensitive()
                assert app.media['title']=='Faixa de teste' and app.media['artist']=='Artista de teste'
                assert app.mpris.properties()['CanPlay'].unpack()
                assert app.mpris.properties()['PlaybackStatus'].unpack()=='Playing'
                app.command('pause'); self.phase=15
            elif self.phase==15:
                if not app.media['paused']: return True
                app.command('play'); self.phase=16
            elif self.phase==16:
                if app.media['paused']: return True
                app.save(mute=True); self.phase=17
            elif self.phase==17:
                if not app.engine.state.get('muted'): return True
                app.save(mute=False)
                app.show_preferences()
                app.background_row.set_active(True)
                assert json.loads(app.settings_path.read_text())['background']
                app.preferences.close()
                self.phase=18
            elif self.phase==18:
                if not app.engine.state.get('tray'): return True
                app.window.close()
                assert app.background and not app.closing
                assert not app.window.get_visible()
                self.phase=19; self.started=time.monotonic()
            elif self.phase==19:
                if time.monotonic()-self.started<1.5: return True
                assert not app.engine.closed() and not app.media['paused']
                if app.engine.state.get('painting'): return True
                metadata=app.mpris.properties()['Metadata'].unpack()
                assert '/artwork/' in metadata['mpris:artUrl'] and metadata['mpris:artUrl'].endswith('.img')
                app.command('open')
                assert app.window.get_visible() and not app.background
                self.phase=20
            elif self.phase==20:
                if not app.engine.state.get('painting'): return True
                app.save(background=False)
                self.phase=21
            elif self.phase==21:
                if app.engine.state.get('tray'): return True
                app.engine.set_frame_rate(60);self.phase=25
            elif self.phase==25:
                if app.engine.state.get('targetFrameRate')!=60:return True
                app.engine.set_frame_rate(144);self.phase=26
            elif self.phase==26:
                if app.engine.state.get('targetFrameRate')!=144:return True
                app.frame_rate=0;app.sync_frame_rate();self.phase=27
            elif self.phase==27:
                if app.engine.state.get('targetFrameRate')!=app.frame_rate:return True
                app.engine.execute('useSessionOnlyPlayer()')
                self.phase=22
            elif self.phase==22:
                if not app.media['paused']: return True
                app.command('play'); self.phase=23
            elif self.phase==23:
                if app.media['paused']: return True
                assert app.media['available'] and app.mpris.properties()['CanPlay'].unpack()
                app.command('pause'); self.phase=24
            elif self.phase==24:
                if not app.media['paused']: return True
                self.first_art=app.mpris.properties()['Metadata'].unpack()['mpris:artUrl']
                assert app.mpris.properties()['CanGoNext'].unpack() and app.mpris.properties()['CanGoPrevious'].unpack()
                app.command('next');self.phase=28
            elif self.phase==28:
                if app.media['title']!='Segunda faixa':return True
                if app.mpris.properties()['Metadata'].unpack()['mpris:artUrl']==self.first_art or not app.mpris.artwork.uri:return True
                app.command('previous');self.phase=29
            elif self.phase==29:
                if app.media['title']!='Faixa de teste' or app.mpris.properties()['Metadata'].unpack()['mpris:artUrl']!=self.first_art:return True
                print('Native Electron smoke PASS: GTK4/libadwaita, single window, native dark/light frame, preferences, GPU persistence, Unicode input, click, scrolling, error/retry, HiDPI physical pixels, live scale changes, zoom, resizing, audio decode/play/pause/mute, background audio, tray lifecycle, reopen, GNOME album artwork changes, next/previous, live frame-rate 60/144/monitor='+str(app.frame_rate)+'; sharedGPU='+str(app.engine.state.get('sharedGPU'))+'; DRM '+json.dumps(app.drm),flush=True)
                app.test_exit=0; app.quit_app(); return False
        except Exception:
            import traceback
            traceback.print_exc(); app.test_exit=1; app.quit_app(); return False
        return True
