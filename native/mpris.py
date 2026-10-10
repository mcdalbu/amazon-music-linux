"""Small, truthful MPRIS interface: transport controls supported by the player."""
from pathlib import Path
from gi.repository import Gio, GLib
from artwork import ArtworkCache

APP_ID = "io.github.amzml.AmazonMusic"
ICON = Path(__file__).resolve().parents[1] / "assets" / (APP_ID + ".png")

XML = """<node>
<interface name="org.mpris.MediaPlayer2">
 <method name="Raise"/><method name="Quit"/>
 <property name="CanQuit" type="b" access="read"/>
 <property name="CanRaise" type="b" access="read"/>
 <property name="HasTrackList" type="b" access="read"/>
 <property name="Identity" type="s" access="read"/>
 <property name="DesktopEntry" type="s" access="read"/>
 <property name="SupportedUriSchemes" type="as" access="read"/>
 <property name="SupportedMimeTypes" type="as" access="read"/>
</interface>
<interface name="org.mpris.MediaPlayer2.Player">
 <method name="PlayPause"/><method name="Play"/><method name="Pause"/><method name="Stop"/>
 <method name="Next"/><method name="Previous"/>
 <method name="Seek"><arg name="Offset" type="x" direction="in"/></method>
 <method name="SetPosition"><arg name="TrackId" type="o" direction="in"/><arg name="Position" type="x" direction="in"/></method>
 <method name="OpenUri"><arg name="Uri" type="s" direction="in"/></method>
 <property name="PlaybackStatus" type="s" access="read"/>
 <property name="Rate" type="d" access="read"/>
 <property name="Metadata" type="a{sv}" access="read"/>
 <property name="Volume" type="d" access="read"/>
 <property name="Position" type="x" access="read"/>
 <property name="MinimumRate" type="d" access="read"/>
 <property name="MaximumRate" type="d" access="read"/>
 <property name="CanGoNext" type="b" access="read"/>
 <property name="CanGoPrevious" type="b" access="read"/>
 <property name="CanPlay" type="b" access="read"/>
 <property name="CanPause" type="b" access="read"/>
 <property name="CanSeek" type="b" access="read"/>
 <property name="CanControl" type="b" access="read"/>
</interface>
</node>"""


class Mpris:
    PATH = "/org/mpris/MediaPlayer2"
    PLAYER = "org.mpris.MediaPlayer2.Player"

    def __init__(self, command, bus_name="org.mpris.MediaPlayer2.amazon_music_linux", artwork_dir=None):
        self.command = command
        self.connection = None
        self.state = {}
        self.registrations = []
        self.artwork=ArtworkCache(artwork_dir or Path(GLib.get_user_cache_dir())/'amazon-music-linux/artwork',self.artwork_changed)
        self.owner = Gio.bus_own_name(
            Gio.BusType.SESSION, bus_name,
            Gio.BusNameOwnerFlags.NONE, self._bus_acquired, None, None)

    def _bus_acquired(self, connection, _name):
        self.connection = connection
        for interface in Gio.DBusNodeInfo.new_for_xml(XML).interfaces:
            self.registrations.append(connection.register_object(
                self.PATH, interface, self._method, self._get, None))

    def _method(self, _connection, _sender, _path, _interface, method, _parameters, invocation):
        commands = {"Raise": "open", "Quit": "quit", "PlayPause": "toggle",
                    "Play": "play", "Pause": "pause", "Stop": "pause", "Next":"next", "Previous":"previous"}
        if method in ('Next','Previous') and not self.properties()['CanGo'+method].unpack():
            invocation.return_dbus_error("org.mpris.MediaPlayer2.Error.NotSupported","A ação não está disponível nesta faixa.")
            return
        if method not in commands:
            invocation.return_dbus_error("org.mpris.MediaPlayer2.Error.NotSupported",
                                         "Use o player para esta operação.")
            return
        self.command(commands[method])
        invocation.return_value(None)

    def properties(self):
        media = self.state.get("media", {})
        available = media.get("available", False)
        status = "Stopped" if not available else ("Paused" if media.get("paused", True) else "Playing")
        metadata = {}
        if available:
            metadata = {"mpris:trackid": GLib.Variant("o", self.PATH + "/current"),
                        "xesam:title": GLib.Variant("s", media.get("title") or "Amazon Music"),
                        "xesam:artist": GLib.Variant("as", [media.get("artist") or "Amazon Music"]),
                        "xesam:album": GLib.Variant("s", media.get("album") or ""),
                        "mpris:artUrl": GLib.Variant("s", getattr(getattr(self,'artwork',None),'uri','') or ICON.as_uri())}
        return {
            "CanQuit": GLib.Variant("b", True), "CanRaise": GLib.Variant("b", True),
            "HasTrackList": GLib.Variant("b", False),
            "Identity": GLib.Variant("s", "Amazon Music Linux"),
            "DesktopEntry": GLib.Variant("s", APP_ID),
            "SupportedUriSchemes": GLib.Variant("as", []),
            "SupportedMimeTypes": GLib.Variant("as", []),
            "PlaybackStatus": GLib.Variant("s", status),
            "Metadata": GLib.Variant("a{sv}", metadata),
            "Rate": GLib.Variant("d", 1.0), "MinimumRate": GLib.Variant("d", 1.0),
            "MaximumRate": GLib.Variant("d", 1.0),
            "Volume": GLib.Variant("d", 0.0 if self.state.get("settings", {}).get("mute") else 1.0),
            "Position": GLib.Variant("x", 0),
            "CanGoNext": GLib.Variant("b", available and media.get('canNext') is True),
            "CanGoPrevious": GLib.Variant("b", available and media.get('canPrevious') is True),
            "CanSeek": GLib.Variant("b", False), "CanControl": GLib.Variant("b", True),
            "CanPlay": GLib.Variant("b", available), "CanPause": GLib.Variant("b", available),
        }

    def _get(self, _connection, _sender, _path, _interface, name):
        return self.properties().get(name)

    def update(self, state):
        before = self.properties()
        self.state = state
        self.artwork.set(state.get('media',{}).get('artwork',''))
        after = self.properties()
        changed = {key: value for key, value in after.items() if value != before[key]}
        if changed and self.connection:
            self.connection.emit_signal(None, self.PATH, "org.freedesktop.DBus.Properties",
                                        "PropertiesChanged", GLib.Variant("(sa{sv}as)",
                                        (self.PLAYER, changed, [])))

    def artwork_changed(self):
        if self.connection:
            self.connection.emit_signal(None,self.PATH,'org.freedesktop.DBus.Properties','PropertiesChanged',
                GLib.Variant('(sa{sv}as)',(self.PLAYER,{'Metadata':self.properties()['Metadata']},[])))

    def close(self):
        self.artwork.close()
        Gio.bus_unown_name(self.owner)
        if self.connection:
            for registration in self.registrations:
                self.connection.unregister_object(registration)
