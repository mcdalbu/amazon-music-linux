"""Private socket bridge for a hidden sandboxed Electron offscreen renderer."""
import json
import mmap
import os
from pathlib import Path
import queue
import socket
import struct
import subprocess
import threading
import time
from gpu import receive_texture

MAX_FRAME = 64 * 1024 * 1024
FRAME_SLOTS = 3

def read_exact(stream, size):
    result = bytearray(size)
    view = memoryview(result)
    offset = 0
    while offset < size:
        count = stream.recv_into(view[offset:])
        if not count: raise EOFError('Electron connection closed')
        offset += count
    # PyGObject has a fast bytes marshaller; bytearray/memoryview are converted
    # element by element and make large textures hundreds of ms slower.
    return bytes(result)

def read_packet(stream):
    length = struct.unpack('!I', read_exact(stream, 4))[0]
    if not 0 < length <= 8192: raise ValueError('Invalid Electron packet header')
    header = json.loads(read_exact(stream, length))
    if not isinstance(header, dict): raise ValueError('Invalid Electron packet')
    if header.get('type') == 'frame':
        w, h, size = header.get('width'), header.get('height'), header.get('bytes')
        if (type(w) is not int or type(h) is not int or type(size) is not int
                or not 0 < w <= 8192 or not 0 < h <= 8192 or size != w * h * 4 or size > MAX_FRAME):
            raise ValueError('Invalid Electron frame dimensions')
        if 'slot' in header:
            if (type(header['slot']) is not int or not 0 <= header['slot'] < FRAME_SLOTS
                    or type(header.get('sequence')) is not int or header['sequence'] <= 0):
                raise ValueError('Invalid shared frame slot')
            return header, None
        return header, read_exact(stream, size)
    if header.get('type') != 'event' or type(header.get('kind')) is not int or not isinstance(header.get('text'), str):
        raise ValueError('Invalid Electron event')
    return header, None

class Electron:
    def __init__(self, runtime, profile, url, paint, event):
        self.paint, self.event = paint, event
        self.state = {}; self.failure = ''; self.failure_reported = False
        self.frame = None; self.frame_lock = threading.Lock()
        self.gpu_frame = None
        self.events = queue.Queue(maxsize=256)
        self.commands = queue.Queue(maxsize=256)
        self.stopping = False; self.close_deadline = 0
        self.channel, child = socket.socketpair()
        self.texture_channel, texture_child = socket.socketpair(socket.AF_UNIX,socket.SOCK_SEQPACKET)
        self.frame_fd = os.memfd_create('amzml-frames', os.MFD_CLOEXEC)
        os.ftruncate(self.frame_fd, MAX_FRAME*FRAME_SLOTS)
        self.frame_memory = mmap.mmap(self.frame_fd, MAX_FRAME*FRAME_SLOTS, access=mmap.ACCESS_READ)
        env = dict(os.environ, AMZML_ENGINE_FD=str(child.fileno()), AMZML_FRAME_FD=str(self.frame_fd),
                   AMZML_TEXTURE_FD=str(texture_child.fileno()), AMZML_PROFILE=str(profile), AMZML_URL=url)
        for name in ('ELECTRON_RUN_AS_NODE', 'CHROME_DESKTOP'): env.pop(name, None)
        root = Path(__file__).resolve().parents[1]
        try:
            self.process = subprocess.Popen([str(Path(runtime)/'electron'), str(root/'electron/main.cjs')],
                                            env=env, pass_fds=(child.fileno(),self.frame_fd,texture_child.fileno()))
        except Exception:
            self.channel.close();self.texture_channel.close(); self.frame_memory.close(); os.close(self.frame_fd); raise
        finally: child.close();texture_child.close()
        self.reader_thread=threading.Thread(target=self.read, daemon=True)
        self.reader_thread.start()
        self.texture_thread=threading.Thread(target=self.read_textures,daemon=True)
        self.texture_thread.start()
        threading.Thread(target=self.write, daemon=True).start()

    def read(self):
        try:
            while True:
                header, data = read_packet(self.channel)
                if header['type'] == 'frame':
                    with self.frame_lock: previous, self.frame = self.frame, (header,data)
                    if previous: self.release_frame(previous[0])
                else: self.events.put_nowait(header)
        except (EOFError, OSError, ValueError, queue.Full) as error:
            if not self.stopping: self.failure = str(error)

    def write(self):
        try:
            while True:
                command = self.commands.get()
                if command is None: return
                self.channel.sendall((json.dumps(command, ensure_ascii=True)+'\n').encode())
        except OSError as error:
            if not self.stopping: self.failure = str(error)

    def read_textures(self):
        try:
            while True:
                frame=receive_texture(self.texture_channel,lambda sequence:self.send('texture-release',sequence=sequence))
                with self.frame_lock:previous,self.gpu_frame=self.gpu_frame,frame
                if previous:previous.release()
        except (EOFError,OSError,ValueError) as error:
            if not self.stopping:self.failure=str(error)

    def send(self, command, **args):
        if self.process.poll() is not None: return
        try: self.commands.put_nowait(dict(command=command, **args))
        except queue.Full: self.failure = 'Electron command queue full'

    def pump(self, present=True):
        while True:
            try: packet = self.events.get_nowait()
            except queue.Empty: break
            if packet['kind'] == 16: self.state = json.loads(packet['text'])
            else: self.event(packet['kind'], packet['text'].encode())
        if present: self.present_frame()
        if not self.stopping and self.process.poll() is not None and not self.failure:
            self.failure = 'Electron exited with code '+str(self.process.returncode)
        if self.failure and not self.failure_reported:
            self.failure_reported = True; self.event(3, self.failure.encode())
        if self.stopping and self.close_deadline and time.monotonic() > self.close_deadline and self.process.poll() is None:
            self.process.kill()

    def present_frame(self):
        with self.frame_lock:
            frame, self.frame = self.frame, None
            gpu_frame,self.gpu_frame=self.gpu_frame,None
        if gpu_frame:
            info=gpu_frame.info
            self.paint(0,info['width'],info['height'],gpu_frame)
        if frame:
            header,data = frame
            try:
                if 'slot' in header:
                    offset=header['slot']*MAX_FRAME
                    data=self.frame_memory[offset:offset+header['bytes']]
                self.paint(0,header['width'],header['height'],data)
            finally: self.release_frame(header)

    def release_frame(self, header):
        if 'slot' in header: self.send('frame-release',slot=header['slot'],sequence=header['sequence'])

    def resize(self, width, height, factor): self.send('resize', width=width, height=height, factor=factor)
    def focus(self, active): self.send('focus', active=bool(active))
    def mute(self, muted): self.send('mute', muted=bool(muted))
    def foreground(self, active): self.send('foreground', active=bool(active))
    def tray(self, enabled, media, muted): self.send('tray', enabled=bool(enabled), media=media, muted=bool(muted))
    def theme(self, theme): self.send('theme', theme=theme)
    def execute(self, script): self.send('script', script=script)
    def media_command(self, action): self.send('media', action=action)
    def set_frame_rate(self, fps): self.send('frame-rate', fps=fps)
    def navigate(self, url): self.send('load', url=url)
    def reload(self): self.send('reload')
    def zoom(self, level): self.send('zoom', level=level)
    def edit(self, action): self.send('edit', action=action.decode() if isinstance(action,bytes) else action)
    def insert_text(self, text): self.send('text', text=text)
    def components(self): self.send('components')
    def update_component(self, _identifier): self.send('update')
    def window_handle(self): return 0 if self.state.get('visibleWindows') == 0 and self.state.get('offscreen') else 1

    @staticmethod
    def modifiers(flags):
        return [name for bit, name in [(2,'shift'),(4,'control'),(8,'alt'),(16,'leftButtonDown'),
                                      (32,'middleButtonDown'),(64,'rightButtonDown'),(128,'meta')] if flags & bit]

    def mouse(self, kind, x, y, button, up, count, flags, dx, dy, precise=False):
        event = dict(x=x, y=y, modifiers=self.modifiers(flags))
        if kind == 0: event['type'] = 'mouseLeave' if up else 'mouseMove'
        elif kind == 1: event.update(type='mouseUp' if up else 'mouseDown', button=['left','middle','right'][button], clickCount=count)
        else: event.update(type='mouseWheel', deltaX=dx, deltaY=dy, canScroll=True,hasPreciseScrollingDeltas=bool(precise))
        self.send('mouse', event=event)

    def key(self, kind, vk, code, char, flags):
        names = {8:'Backspace',9:'Tab',13:'Enter',27:'Escape',32:'Space',33:'PageUp',34:'PageDown',
                 35:'End',36:'Home',37:'Left',38:'Up',39:'Right',40:'Down',45:'Insert',46:'Delete'}
        key = names.get(vk, chr(vk) if 48 <= vk <= 90 else '')
        if key and kind != 3:
            self.send('key', event=dict(type='keyUp' if kind == 2 else 'keyDown', keyCode=key, modifiers=self.modifiers(flags)))

    def close(self):
        self.stopping = True; self.close_deadline = time.monotonic()+5
        self.send('close')
    def closed(self): return self.process.poll() is not None
    def shutdown(self):
        self.stopping=True
        if self.process.poll() is None: self.process.kill()
        self.process.wait(timeout=5)
        try: self.channel.shutdown(socket.SHUT_RDWR)
        except OSError: pass
        self.channel.close()
        self.reader_thread.join(timeout=1)
        try:self.texture_channel.shutdown(socket.SHUT_RDWR)
        except OSError:pass
        self.texture_channel.close();self.texture_thread.join(timeout=1)
        with self.frame_lock:
            if self.gpu_frame:self.gpu_frame.release();self.gpu_frame=None
        with self.frame_lock: self.frame = None
        self.frame_memory.close(); os.close(self.frame_fd)
        try: self.commands.put_nowait(None)
        except queue.Full: pass
