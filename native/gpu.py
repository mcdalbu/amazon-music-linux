"""Validated DMA-BUF leases from Electron's private texture socket."""
import array
import json
import os
import socket

FORMATS={'bgra':int.from_bytes(b'AR24','little'), 'rgba':int.from_bytes(b'AB24','little')}

class TextureFrame:
    def __init__(self, info, fds, release):
        self.info=info; self.fds=fds; self.release_callback=release; self.released=False

    def release(self):
        if self.released:return
        self.released=True
        for fd in self.fds:os.close(fd)
        self.release_callback(self.info['sequence'])

    def build(self, display):
        from gi.repository import Gdk
        info=self.info
        builder=Gdk.DmabufTextureBuilder.new()
        builder.set_display(display);builder.set_width(info['width']);builder.set_height(info['height'])
        builder.set_fourcc(FORMATS[info['format']]);builder.set_modifier(int(info['modifier']))
        builder.set_premultiplied(True);builder.set_n_planes(len(self.fds))
        for index,(fd,plane) in enumerate(zip(self.fds,info['planes'])):
            builder.set_fd(index,fd);builder.set_stride(index,plane['stride']);builder.set_offset(index,plane['offset'])
        # GTK calls this after its last texture reference (including GPU rendering)
        # is gone. Releasing at set_paintable would let Chromium overwrite it.
        texture=builder.build(lambda *_:self.release(),1)
        if texture is None:raise ValueError('GTK could not import the GPU texture')
        return texture

def receive_texture(channel, release):
    payload, ancillary, flags, _=channel.recvmsg(8192,socket.CMSG_SPACE(4*array.array('i').itemsize),socket.MSG_CMSG_CLOEXEC)
    fds=[]
    try:
        for level,kind,body in ancillary:
            if level==socket.SOL_SOCKET and kind==socket.SCM_RIGHTS:
                values=array.array('i');values.frombytes(body[:len(body)//values.itemsize*values.itemsize]);fds.extend(values)
        if not payload:raise EOFError('Texture connection closed')
        if flags & (socket.MSG_TRUNC|socket.MSG_CTRUNC):raise ValueError('Truncated texture packet')
        info=json.loads(payload)
        if not isinstance(info,dict):raise ValueError('Invalid texture packet')
        for name in ('width','height','sequence'):
            if type(info.get(name)) is not int or info[name]<=0:raise ValueError('Invalid texture geometry')
        if info['width']>8192 or info['height']>8192 or info.get('format') not in FORMATS:raise ValueError('Unsupported texture')
        modifier=info.get('modifier')
        if not isinstance(modifier,str) or not modifier.isdecimal() or not 0<=int(modifier)<2**64:raise ValueError('Invalid texture modifier')
        planes=info.get('planes')
        if not isinstance(planes,list) or not 1<=len(planes)==len(fds)<=4:raise ValueError('Invalid texture planes')
        for plane in planes:
            if not isinstance(plane,dict) or any(type(plane.get(key)) is not int for key in ('stride','offset','size')):raise ValueError('Invalid texture plane')
            if not 0<plane['stride']<=2**32-1 or not 0<=plane['offset']<=2**32-1 or not 0<plane['size']<=256*1024*1024:raise ValueError('Invalid texture layout')
        return TextureFrame(info,fds,release)
    except Exception:
        for fd in fds:os.close(fd)
        raise
