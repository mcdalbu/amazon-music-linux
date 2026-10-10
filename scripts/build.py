#!/usr/bin/python3
"""Build the GTK4/libadwaita + Electron Amazon Music RPM."""
import argparse
import json
from pathlib import Path
import platform
import shutil
import subprocess
import tarfile
from build_electron import ROOT, build_runtime, digest, extract_runtime
from build_gpu_bridge import build_bridge
# Retained for archive-policy unit tests.

def build():
    runtime=build_runtime()
    build_bridge()
    if not shutil.which('rpmbuild'): raise RuntimeError('Install rpm-build to create an RPM.')
    version=json.loads((ROOT/'package.json').read_text())['version']
    top=ROOT/'build/rpm-electron-native'
    for directory in ['BUILD','BUILDROOT','RPMS','SOURCES','SPECS','SRPMS','tmp']:
        (top/directory).mkdir(parents=True,exist_ok=True)
    stage=ROOT/'build/stage-electron-native'/f'amazon-music-linux-{version}'
    if stage.exists(): shutil.rmtree(stage)
    app=stage/'app'; app.mkdir(parents=True)
    for directory in ['native','electron','assets']:
        shutil.copytree(ROOT/directory,app/directory,ignore=shutil.ignore_patterns('__pycache__','*.pyc'))
    for filename in ['package.json','LICENSE','README.md']: shutil.copy2(ROOT/filename,app)
    shutil.copy2(ROOT/'vendor/node-api/LICENSE',app/'electron/LICENSE.Node-API')
    (app/'tests').mkdir(); shutil.copy2(ROOT/'tests/player_fixture.html',app/'tests/player_fixture.html')
    shutil.copytree(runtime,app/'runtime')
    shutil.copytree(ROOT/'packaging',stage/'packaging')
    source=top/'SOURCES'/f'amazon-music-linux-{version}.tar.gz'
    with tarfile.open(source,'w:gz') as archive: archive.add(stage,arcname=stage.name)
    spec=(ROOT/'packaging/amazon-music-linux.spec.in').read_text().replace('@VERSION@',version)
    spec_path=top/'SPECS/amazon-music-linux.spec'; spec_path.write_text(spec)
    arch={'x86_64':'x86_64','aarch64':'aarch64'}[platform.machine()]
    subprocess.run(['rpmbuild','-bb','--define',f'_topdir {top}','--define',f'_tmppath {top / "tmp"}',
                    '--target',arch,'--define','_binary_payload w6T2.zstdio',str(spec_path)],check=True)
    output=ROOT/'dist'; output.mkdir(exist_ok=True)
    for rpm in (top/'RPMS'/arch).glob(f'amazon-music-linux-{version}-*.rpm'):
        target=output/rpm.name; shutil.copy2(rpm,target)
        target.with_suffix('.rpm.sha256').write_text(f'{digest(target)}  {target.name}\n')
        print('RPM:',target)

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime-only',action='store_true')
    args=parser.parse_args()
    try:
        if args.runtime_only: print(build_runtime())
        else: build()
    except (OSError,ValueError,RuntimeError,subprocess.CalledProcessError) as error:
        parser.exit(1,f'Error: {error}\n')
