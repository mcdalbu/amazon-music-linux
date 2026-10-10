import sys
from pathlib import Path
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'native'))
from policy import amazon_url,music_url,https_url,clean_settings,clean_media
class PolicyTest(unittest.TestCase):
    def test_navigation(self):
        for u in ['https://music.amazon.com.br/', 'https://www.amazon.com/ap/signin', 'https://music.amazon.co.uk/']:
            self.assertTrue(amazon_url(u))
        for u in ['http://music.amazon.com/','https://amazon.com.attacker.example/','https://evilamazon.com/',
                  'https://user:secret@amazon.com/','file:///etc/passwd','https://amazon.com:8443/']:
            self.assertFalse(amazon_url(u))
        self.assertTrue(music_url('https://music.amazon.com.br/'))
        self.assertFalse(music_url('https://www.amazon.com/'))
    def test_external_links(self):
        self.assertTrue(https_url('https://example.org/path'))
        self.assertFalse(https_url('javascript:alert(1)'))
    def test_settings(self):
        self.assertEqual(clean_settings({'region':'XX','theme':'bad','hardwareAcceleration':1,'extra':True}),
            {'region':'BR','theme':'system','hardwareAcceleration':False,'mute':False,'background':False})
        self.assertTrue(clean_settings({'hardwareAcceleration':True})['hardwareAcceleration'])
        self.assertTrue(clean_settings({'background':True})['background'])
        self.assertFalse(clean_settings({'background':'true'})['background'])
    def test_media(self):
        self.assertIsNone(clean_media({'available':1,'paused':False}))
        self.assertEqual(len(clean_media({'available':True,'paused':False,'title':'x'*500})['title']),256)
