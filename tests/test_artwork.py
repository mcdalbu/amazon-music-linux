"""Stale covers never replace the active track; only trusted raster art is read."""
import base64
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'native'))
from artwork import ArtworkCache,fetch_artwork
from policy import artwork_url
from gi.repository import GLib
PNG='iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGPQaNqn0bSPAUIBACUWBaGsNM6xAAAAAElFTkSuQmCC'

class AlbumArtworkTest(unittest.TestCase):
    def test_only_trusted_https_or_small_raster_data_is_accepted(self):
        for url in ['file:///etc/passwd','https://evil.test/a.jpg','https://media-amazon.com.evil.test/a.jpg',
                    'data:image/svg+xml;base64,AAAA','https://u:p@m.media-amazon.com/a','x'*4097]:
            self.assertEqual(artwork_url(url),'')
        self.assertTrue(artwork_url('https://m.media-amazon.com/images/a.jpg'))
        self.assertEqual(fetch_artwork('data:image/png;base64,'+PNG),base64.b64decode(PNG))
    def test_old_async_download_cannot_replace_new_track_cover(self):
        with tempfile.TemporaryDirectory() as directory:
            cache=ArtworkCache(directory,lambda:None)
            cache.set('');cache.url='https://m.media-amazon.com/old.jpg';cache.generation=1
            cache.url='https://m.media-amazon.com/new.jpg';cache.generation=2
            cache.ready(1,'file:///old.png');self.assertEqual(cache.uri,'')
            cache.ready(2,'file:///new.png');self.assertEqual(cache.uri,'file:///new.png')
            cache.set('');self.assertEqual(cache.uri,'')
            cache.close();cache.ready(cache.generation,'file:///late.png');self.assertEqual(cache.uri,'')
    def test_download_validates_image_and_publishes_local_file(self):
        with tempfile.TemporaryDirectory() as directory:
            changed=[];cache=ArtworkCache(directory,lambda:changed.append(cache.uri))
            cache.set('data:image/png;base64,'+PNG)
            context=GLib.MainContext.default();deadline=time.monotonic()+2
            while not changed and time.monotonic()<deadline:
                while context.pending():context.iteration(False)
                time.sleep(.005)
            self.assertEqual(len(changed),1);self.assertTrue(cache.uri.startswith('file:'))
            self.assertEqual(len(list(Path(directory).glob('*.img'))),1)
            cache.close()
