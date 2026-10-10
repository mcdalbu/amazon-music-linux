"""Observe the desktop's StatusNotifier host without starting or modifying it."""
from gi.repository import Gio

class TrayHost:
    def __init__(self, changed):
        self.changed = changed
        self.proxy = None
        self.closed = False
        self.available = False
        Gio.DBusProxy.new_for_bus(Gio.BusType.SESSION, Gio.DBusProxyFlags.DO_NOT_AUTO_START,
            None, 'org.kde.StatusNotifierWatcher', '/StatusNotifierWatcher',
            'org.kde.StatusNotifierWatcher', None, self.ready)

    def ready(self, _source, result):
        try: proxy = Gio.DBusProxy.new_for_bus_finish(result)
        except Exception:
            if not self.closed: self.changed(False)
            return
        if self.closed: return
        self.proxy = proxy
        self.handlers = [proxy.connect('notify::g-name-owner', lambda *_: self.refresh()),
                         proxy.connect('g-properties-changed', lambda *_: self.refresh())]
        self.refresh()

    def refresh(self):
        registered = self.proxy.get_cached_property('IsStatusNotifierHostRegistered')
        self.available = bool(self.proxy.get_name_owner() and registered and registered.unpack())
        self.changed(self.available)

    def close(self):
        self.closed = True
        if self.proxy:
            for handler in self.handlers: self.proxy.disconnect(handler)
