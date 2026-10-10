"""Descriptor transfer, validation and exact-once lease release."""
import array
import json
import os
from pathlib import Path
import socket
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'native'))
from gpu import receive_texture

class DmabufProtocolTest(unittest.TestCase):
    def send(self,info,fds):
        self.sender.sendmsg([json.dumps(info).encode()],[(socket.SOL_SOCKET,socket.SCM_RIGHTS,array.array('i',fds))])
    def setUp(self):
        self.sender,self.receiver=socket.socketpair(socket.AF_UNIX,socket.SOCK_SEQPACKET)
        self.fd=os.memfd_create('test-gpu-frame',os.MFD_CLOEXEC);os.ftruncate(self.fd,16)
        self.info=dict(sequence=1,width=2,height=2,format='bgra',modifier='0',planes=[dict(stride=8,offset=0,size=16)])
    def tearDown(self):self.sender.close();self.receiver.close();os.close(self.fd)
    def test_received_descriptor_is_an_owned_duplicate_and_release_is_exactly_once(self):
        self.send(self.info,[self.fd]);released=[]
        frame=receive_texture(self.receiver,released.append)
        self.assertNotEqual(frame.fds[0],self.fd);self.assertFalse(os.get_inheritable(frame.fds[0]))
        os.pwrite(self.fd,b'gpu',0);self.assertEqual(os.pread(frame.fds[0],3,0),b'gpu')
        frame.release();frame.release();self.assertEqual(released,[1])
        with self.assertRaises(OSError):os.fstat(frame.fds[0])
        os.fstat(self.fd)
    def test_rejects_bad_geometry_and_layout_without_descriptor_leaks(self):
        for change in [dict(width=0),dict(width=True),dict(height=9000),dict(format='nv12'),
                       dict(modifier='-1'),dict(modifier=str(2**64)),dict(planes=[]),
                       dict(planes=[dict(stride=0,offset=0,size=16)])]:
            before=len(list(Path('/proc/self/fd').iterdir()))
            self.send(dict(self.info,**change),[self.fd])
            with self.assertRaises(ValueError):receive_texture(self.receiver,lambda _:None)
            self.assertEqual(len(list(Path('/proc/self/fd').iterdir())),before)
