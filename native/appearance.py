"""Read and watch the desktop color scheme without changing system settings."""
from gi.repository import Gio, GLib

NAMESPACE = "org.freedesktop.appearance"
PORTAL = "org.freedesktop.portal.Desktop"
PORTAL_PATH = "/org/freedesktop/portal/desktop"
INTERFACE = "org.freedesktop.portal.Settings"


def resolve_theme(portal, scheme="default", gtk_theme=""):
    if portal == 1:
        return "dark"
    if portal == 2:
        return "light"
    if scheme == "prefer-dark":
        return "dark"
    if scheme == "prefer-light":
        return "light"
    if gtk_theme.lower().endswith("-dark"):
        return "dark"
    return "system"


def unpack_variant(value):
    while isinstance(value, GLib.Variant):
        value = value.unpack()
    if isinstance(value, (tuple, list)) and len(value) == 1:
        return unpack_variant(value[0])
    return value


class Appearance:
    def __init__(self, changed):
        self.changed = changed
        self.portal = None
        self.current = None
        self.settings = None
        self.signals = []
        self.connection = None
        self.subscription = None
        self.closed = False
        source = Gio.SettingsSchemaSource.get_default()
        schema = source.lookup("org.gnome.desktop.interface", True) if source else None
        if schema:
            self.settings = Gio.Settings.new_full(schema, None, None)
            for key in ["color-scheme", "gtk-theme"]:
                if schema.has_key(key):
                    self.signals.append(self.settings.connect("changed::" + key, lambda *_: self._publish()))
        self._publish()
        Gio.bus_get(Gio.BusType.SESSION, None, self._connected)

    def _publish(self):
        schema = self.settings.props.settings_schema if self.settings else None
        scheme = self.settings.get_string("color-scheme") if schema and schema.has_key("color-scheme") else "default"
        gtk_theme = self.settings.get_string("gtk-theme") if schema and schema.has_key("gtk-theme") else ""
        theme = resolve_theme(self.portal, scheme, gtk_theme)
        if theme != self.current and not self.closed:
            self.current = theme
            self.changed(theme)

    def _connected(self, _source, result):
        if self.closed:
            return
        try:
            self.connection = Gio.bus_get_finish(result)
        except GLib.Error:
            return
        self.subscription = self.connection.signal_subscribe(
            PORTAL, INTERFACE, "SettingChanged", PORTAL_PATH, NAMESPACE,
            Gio.DBusSignalFlags.NONE, self._setting_changed)
        self._read("ReadOne")

    def _read(self, method):
        self.connection.call(PORTAL, PORTAL_PATH, INTERFACE, method,
                             GLib.Variant("(ss)", (NAMESPACE, "color-scheme")),
                             GLib.VariantType.new("(v)"), Gio.DBusCallFlags.NONE,
                             3000, None, self._read_done, method)

    def _read_done(self, connection, result, method):
        if self.closed:
            return
        try:
            self.portal = unpack_variant(connection.call_finish(result))
            self._publish()
        except GLib.Error:
            if method == "ReadOne":
                self._read("Read")

    def _setting_changed(self, _connection, _sender, _path, _interface, _signal, parameters):
        namespace, key, value = parameters.unpack()
        if namespace == NAMESPACE and key == "color-scheme":
            self.portal = unpack_variant(value)
            self._publish()

    def close(self):
        self.closed = True
        if self.subscription:
            self.connection.signal_unsubscribe(self.subscription)
        if self.settings:
            for signal_id in self.signals:
                self.settings.disconnect(signal_id)
