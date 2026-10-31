from pathlib import Path
import hashlib,json
root=Path(__file__).resolve().parent.parent
folder=root/'android/app/src/main/assets/piper/en_US-lessac-high'
if not (folder/'files.json').is_file():
    raise SystemExit('Missing Piper assets. Run python scripts/prepare-piper.py first.')
files=json.loads((folder/'files.json').read_text(encoding='utf-8'))
for name,expected in files.items():
    p=(folder/name).resolve()
    if folder.resolve() not in p.parents:raise SystemExit('Unsafe asset path')
    if not p.is_file() or p.stat().st_size!=expected['bytes'] or hashlib.sha256(p.read_bytes()).hexdigest()!=expected['sha256']:
        raise SystemExit('Piper asset verification failed: '+name)
config=json.loads((folder/'config.json').read_text(encoding='utf-8'))
assert config['audio']['quality']=='high' and config['language']['code']=='en_US'
assert config['audio']['sample_rate']==22050
aar=root/'android/app/libs/sherpa-onnx-1.13.3.aar'
assert hashlib.sha256(aar.read_bytes()).hexdigest()=='243ad797a3b6e75ebbeaf7a2ab4aec0777e7d71b730685abb762a120940b07b6'
print(f'Piper lessac-high assets verified: {len(files)} files, {sum(x["bytes"] for x in files.values())} bytes; runtime AAR checksum verified.')
