"""Reject malformed frames before allocation and handle stream fragmentation."""
import json
import mmap
from pathlib import Path
import struct
import sys
import threading
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'native'))
from electron import read_packet, Electron, MAX_FRAME

class FragmentedStream:
    def __init__(self, data): self.data = data
    def recv(self, size):
        result, self.data = self.data[:min(size,3)], self.data[min(size,3):]
        return result
    def recv_into(self, view):
        chunk=self.recv(len(view)); view[:len(chunk)]=chunk; return len(chunk)

def packet(header, body=b''):
    data = json.dumps(header).encode()
    return FragmentedStream(struct.pack('!I', len(data))+data+body)

class ElectronProtocolTest(unittest.TestCase):
    def test_fractional_touchpad_input_is_not_truncated_or_treated_as_a_wheel(self):
        engine=object.__new__(Electron);events=[];engine.send=lambda command,**args:events.append(args['event'])
        engine.mouse(2,10,20,0,0,1,0,0.25,-0.4,precise=True)
        self.assertEqual(events[0]['deltaX'],0.25);self.assertEqual(events[0]['deltaY'],-0.4)
        self.assertTrue(events[0]['hasPreciseScrollingDeltas'])
        engine.mouse(2,10,20,0,0,1,0,0,-40)
        self.assertFalse(events[1]['hasPreciseScrollingDeltas'])
    def test_fragmented_bitmap(self):
        header = dict(type='frame',width=2,height=1,bytes=8)
        self.assertEqual(read_packet(packet(header,b'12345678')), (header,b'12345678'))
    def test_invalid_dimensions_and_payloads(self):
        for w,h,size in [(0,1,0),(8193,1,32772),(1,1,8),(8192,8192,268435456),(True,1,4)]:
            with self.subTest(width=w,height=h,size=size), self.assertRaises(ValueError):
                read_packet(packet(dict(type='frame',width=w,height=h,bytes=size)))
    def test_invalid_header(self):
        for header in [[],None,dict(type='event',kind=2,text=42),dict(type='unknown')]:
            with self.subTest(header=header), self.assertRaises(ValueError): read_packet(packet(header))
        with self.assertRaises(ValueError): read_packet(FragmentedStream(struct.pack('!I',8193)))
    def test_truncated_packet(self):
        with self.assertRaises(EOFError): read_packet(packet(dict(type='frame',width=1,height=1,bytes=4),b'x'))
    def test_event(self):
        header = dict(type='event',kind=2,text='https://music.amazon.com.br/')
        self.assertEqual(read_packet(packet(header)), (header,None))
    def test_shared_frame_geometry_and_lease(self):
        header=dict(type='frame',width=2,height=1,bytes=8,slot=2,sequence=42)
        self.assertEqual(read_packet(packet(header)),(header,None))
        for slot,sequence in [(3,1),(-1,1),(True,1),(0,0),(0,True),(0,None)]:
            with self.subTest(slot=slot,sequence=sequence),self.assertRaises(ValueError):
                read_packet(packet(dict(header,slot=slot,sequence=sequence)))
    def test_shared_slot_is_copied_before_acknowledgement(self):
        engine=object.__new__(Electron)
        engine.frame_lock=threading.Lock()
        engine.gpu_frame=None
        engine.frame_memory=mmap.mmap(-1,MAX_FRAME)
        engine.frame_memory[:8]=b'12345678'
        engine.frame=(dict(type='frame',width=2,height=1,bytes=8,slot=0,sequence=7),None)
        operations=[]
        engine.paint=lambda *args:operations.append(('paint',args))
        def send(command,**args):
            operations.append((command,args));engine.frame_memory[:8]=b'87654321'
        engine.send=send
        try:
            engine.present_frame()
            self.assertEqual(operations,[('paint',(0,2,1,b'12345678')),('frame-release',{'slot':0,'sequence':7})])
            self.assertIsNone(engine.frame)
            engine.present_frame();self.assertEqual(len(operations),2)
        finally:engine.frame_memory.close()
