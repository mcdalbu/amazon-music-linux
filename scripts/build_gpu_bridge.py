#!/usr/bin/python3
"""Build a stable Node-API addon; no Electron ABI rebuild or npm dependency."""
from pathlib import Path
import os
import subprocess

ROOT=Path(__file__).resolve().parents[1]
def build_bridge():
    target=ROOT/'electron/gpu-bridge.node'
    subprocess.run([os.environ.get('CC','cc'),'-std=c11','-O2','-Wall','-Wextra','-Werror',
                    '-fPIC','-shared','-D_GNU_SOURCE','-DNAPI_VERSION=8',
                    '-I'+str(ROOT/'vendor/node-api'),str(ROOT/'electron/gpu-bridge.c'),
                    '-o',str(target)],check=True)
    return target

if __name__=='__main__': print(build_bridge())
