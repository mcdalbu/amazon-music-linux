"""Bounded, asynchronous album art cache for desktop MPRIS consumers."""
import base64
import hashlib
import os
from pathlib import Path
import tempfile
import threading
import struct
import zlib
from urllib.request import HTTPRedirectHandler, build_opener
from urllib.error import URLError
from gi.repository import GLib
from policy import artwork_url

MAX_ART=4*1024*1024

def raster_dimensions(body):
    # Inspect headers without spawning an image decoder on the UI thread.
    if body.startswith(b'\x89PNG\r\n\x1a\n') and len(body)>=33 and body[8:16]==b'\x00\x00\x00\rIHDR':
        if zlib.crc32(body[12:29])&0xffffffff!=struct.unpack('>I',body[29:33])[0]:raise ValueError('Invalid PNG header')
        return struct.unpack('>II',body[16:24])
    if body.startswith(b'\xff\xd8\xff'):
        offset=2
        while offset+4<=len(body):
            if body[offset]!=255:break
            while offset<len(body) and body[offset]==255:offset+=1
            if offset>=len(body):break
            marker=body[offset];offset+=1
            if marker in (0xd8,0xd9) or 0xd0<=marker<=0xd7:continue
            length=int.from_bytes(body[offset:offset+2],'big')
            if length<2 or offset+length>len(body):break
            if marker in (0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf) and length>=7:
                height,width=struct.unpack('>HH',body[offset+3:offset+7]);return width,height
            offset+=length
    raise ValueError('Unsupported album art image')

class ArtworkRedirect(HTTPRedirectHandler):
    def redirect_request(self,request,fp,code,msg,headers,newurl):
        if not artwork_url(newurl) or not newurl.startswith('https:'):raise URLError('Unsupported artwork redirect')
        return super().redirect_request(request,fp,code,msg,headers,newurl)

def fetch_artwork(url):
    if not artwork_url(url):raise ValueError('Invalid album art URL')
    if url.startswith('data:'):return base64.b64decode(url.split(',',1)[1],validate=True)
    with build_opener(ArtworkRedirect()).open(url,timeout=6) as response:
        body=response.read(MAX_ART+1)
    if len(body)>MAX_ART:raise ValueError('Album art exceeds cache limit')
    return body

class ArtworkCache:
    def __init__(self,directory,changed,fetch=fetch_artwork):
        self.directory=Path(directory);self.directory.mkdir(mode=0o700,parents=True,exist_ok=True)
        self.changed=changed;self.fetch=fetch;self.url='';self.uri='';self.generation=0;self.closed=False

    def set(self,url):
        url=artwork_url(url)
        if url==self.url:return
        self.url=url;self.uri='';self.generation+=1
        if not url:return
        target=self.directory/(hashlib.sha256(url.encode()).hexdigest()+'.img')
        if target.is_file():self.uri=target.as_uri();return
        generation=self.generation
        threading.Thread(target=self.load,args=(url,target,generation),daemon=True).start()

    def load(self,url,target,generation):
        temporary=None
        try:
            body=self.fetch(url)
            if not body or len(body)>MAX_ART:raise ValueError('Unsupported album art image')
            width,height=raster_dimensions(body)
            if not 0<width<=4096 or not 0<height<=4096:raise ValueError('Invalid album art dimensions')
            fd,temporary=tempfile.mkstemp(prefix='.art-',dir=self.directory)
            with os.fdopen(fd,'wb') as output:output.write(body)
            os.replace(temporary,target);temporary=None
            # Keep a small on-disk cache; downloading never blocks GTK or audio.
            others=sorted(self.directory.glob('*.img'),key=lambda p:p.stat().st_mtime,reverse=True)
            for old in others[32:]:
                if old!=target:old.unlink(missing_ok=True)
            GLib.idle_add(self.ready,generation,target.as_uri())
        except (OSError,ValueError,URLError):pass
        finally:
            if temporary:Path(temporary).unlink(missing_ok=True)

    def ready(self,generation,uri):
        if not self.closed and generation==self.generation:
            self.uri=uri;self.changed()
        return GLib.SOURCE_REMOVE

    def close(self):self.closed=True;self.generation+=1
