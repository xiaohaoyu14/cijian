"""Download the selected full-precision Piper model and matching Android runtime."""
from pathlib import Path
import hashlib,json,shutil,tarfile,urllib.request
root=Path(__file__).resolve().parent.parent
cache=root/'.downloads';cache.mkdir(exist_ok=True)
urls={
 'vits-piper-en_US-lessac-high.tar.bz2':'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-en_US-lessac-high.tar.bz2',
 'sherpa-onnx-1.13.3.aar':'https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.3/sherpa-onnx-1.13.3.aar',
}
lock=json.loads((root/'models.lock.json').read_text(encoding='utf-8'))
def download(name,url,digest=None):
 p=cache/name
 if not p.is_file() or (digest and hashlib.sha256(p.read_bytes()).hexdigest()!=digest):
  tmp=p.with_suffix(p.suffix+'.part')
  print('Downloading',name,flush=True)
  with urllib.request.urlopen(url,timeout=120) as response,tmp.open('wb') as out:shutil.copyfileobj(response,out)
  if digest and hashlib.sha256(tmp.read_bytes()).hexdigest()!=digest:raise SystemExit('Checksum mismatch: '+name)
  tmp.replace(p)
 return p
archive=download(next(iter(urls)),next(iter(urls.values())),lock['modelArchiveSha256'])
aar=download('sherpa-onnx-1.13.3.aar',urls['sherpa-onnx-1.13.3.aar'],lock['runtimeSha256'])
extract=cache/'prepared';extract.mkdir(exist_ok=True)
with tarfile.open(archive,'r:bz2') as t:
 for m in t.getmembers():
  if extract.resolve() not in (extract/m.name).resolve().parents or not(m.isfile() or m.isdir()):raise SystemExit('Unsafe archive path')
 t.extractall(extract)
source=extract/'vits-piper-en_US-lessac-high';target=root/'android/app/src/main/assets/piper/en_US-lessac-high';target.mkdir(parents=True,exist_ok=True)
for p in source.iterdir():
 if p.is_dir():shutil.copytree(p,target/p.name,dirs_exist_ok=True)
 elif p.suffix in ['.onnx','.json','.txt'] or p.name in ['MODEL_CARD','LICENSE']:shutil.copy2(p,target/p.name)
shutil.copy2(target/'en_US-lessac-high.onnx.json',target/'config.json')
files={p.relative_to(target).as_posix():{'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(target.rglob('*')) if p.is_file() and p.name!='files.json'}
(target/'files.json').write_text(json.dumps(files,indent=2),encoding='utf-8')
libs=root/'android/app/libs';libs.mkdir(exist_ok=True);shutil.copy2(aar,libs/aar.name)
print('Prepared full-precision en_US-lessac-high and Android runtime; run scripts/verify-piper-assets.py next.')
