"""The GNOME media card needs artUrl separately from the application identity."""
from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'native'))
from mpris import Mpris, APP_ID, ICON

class MprisIconTest(unittest.TestCase):
    def player(self, media):
        player=object.__new__(Mpris)
        player.state={'media':media, 'settings':{}}
        return player
    def test_gnome_identity_and_artwork(self):
        props=self.player({'available':True,'paused':False,'title':'Faixa de teste'}).properties()
        self.assertEqual(props['DesktopEntry'].unpack(),APP_ID)
        metadata=props['Metadata'].unpack()
        self.assertEqual(metadata['mpris:artUrl'],ICON.as_uri())
        self.assertTrue(ICON.is_file())
        self.assertEqual(ICON.read_bytes()[:8],b'\x89PNG\r\n\x1a\n')
        self.assertEqual(metadata['xesam:title'],'Faixa de teste')
        self.assertEqual(metadata['xesam:artist'],['Amazon Music'])
    def test_stopped_player_does_not_advertise_a_track(self):
        props=self.player({'available':False,'paused':True}).properties()
        self.assertEqual(props['Metadata'].unpack(),{})
        self.assertFalse(props['CanPlay'].unpack())
    def test_track_session_metadata_and_gnome_visibility(self):
        for paused,status in [(False,'Playing'),(True,'Paused')]:
            props=self.player({'available':True,'paused':paused,'title':'Dirty Paws',
                               'artist':'Of Monsters and Men','album':'My Head Is an Animal'}).properties()
            self.assertTrue(props['CanPlay'].unpack())
            self.assertEqual(props['PlaybackStatus'].unpack(),status)
            self.assertEqual(props['Metadata'].unpack()['xesam:artist'],['Of Monsters and Men'])
            self.assertEqual(props['Metadata'].unpack()['xesam:album'],'My Head Is an Animal')
    def test_album_art_and_transport_capabilities(self):
        from types import SimpleNamespace
        player=self.player({'available':True,'paused':False,'canNext':True,'canPrevious':True})
        player.artwork=SimpleNamespace(uri='file:///tmp/current-album.png')
        props=player.properties()
        self.assertEqual(props['Metadata'].unpack()['mpris:artUrl'],'file:///tmp/current-album.png')
        self.assertTrue(props['CanGoNext'].unpack());self.assertTrue(props['CanGoPrevious'].unpack())
        player.state['media']['available']=False
        self.assertFalse(player.properties()['CanGoNext'].unpack())
        commands=[];player.command=commands.append
        player.state['media']['available']=True
        class Invocation:
            def return_value(self,_):pass
            def return_dbus_error(self,*_):raise AssertionError('Available command was rejected')
        for method in ['Next','Previous']:player._method(None,None,None,None,method,None,Invocation())
        self.assertEqual(commands,['next','previous'])
