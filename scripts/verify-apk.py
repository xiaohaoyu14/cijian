from pathlib import Path
import hashlib,json,struct,zipfile
root=Path(__file__).resolve().parent.parent
version=json.loads((root/'package.json').read_text(encoding='utf-8'))['version']
apk=root/f'deliverables/词间-{version}-arm64-v8a.apk'
assetroot=root/'android/app/src/main/assets/piper/en_US-lessac-high'
files=json.loads((assetroot/'files.json').read_text(encoding='utf-8'))
with zipfile.ZipFile(apk) as z:
    names=z.namelist()
    native=[n for n in names if n.startswith('lib/') and n.endswith('.so')]
    assert native and {n.split('/')[1] for n in native}=={'arm64-v8a'}
    assert not [n for n in names if n.lower().endswith(('.mp3','.wav','.ogg','.m4a'))]
    for name,expected in files.items():
        data=z.read('assets/piper/en_US-lessac-high/'+name)
        assert len(data)==expected['bytes'] and hashlib.sha256(data).hexdigest()==expected['sha256'],name
    for p in (root/'dist').rglob('*'):
        if p.is_file():assert z.read('assets/public/'+p.relative_to(root/'dist').as_posix())==p.read_bytes()
    for name in native:
        b=z.read(name);off=struct.unpack_from('<Q',b,32)[0];size,count=struct.unpack_from('<HH',b,54)
        aligns=[struct.unpack_from('<Q',b,off+i*size+48)[0] for i in range(count) if struct.unpack_from('<I',b,off+i*size)[0]==1]
        assert aligns and all(a>=16384 for a in aligns),name
    for name in names:
        if name.endswith('.dex'):assert b'Landroid/speech/tts/' not in z.read(name), 'System TTS dependency in '+name
    content=json.loads((root/'content.lock.json').read_text(encoding='utf-8'))
    import io
    sources=[{**content,'asset':'builtin-cet4.pack'},*content['additional']]
    for source in sources:
        packed=z.read('assets/public/'+source['asset'])
        assert hashlib.sha256(packed).hexdigest()==source['sha256']
        with zipfile.ZipFile(io.BytesIO(packed)) as words:
            assert len(json.loads(words.read('entries.json').decode('utf-8-sig')))==source['entryCount']
    assert 'url' not in json.loads(z.read('assets/capacitor.config.json')).get('server',{})
    html=z.read('assets/public/index.html').decode('utf-8')
    assert "connect-src 'self' https:;" in html
    assert 'http://127.0.0.1:' not in html and 'http://localhost:' not in html
    assert not [n for n in names if n.endswith(('.jks','.keystore','.pfx','access-key.txt','password.txt'))]
report={'apk':apk.name,'bytes':apk.stat().st_size,'sha256':hashlib.sha256(apk.read_bytes()).hexdigest(),'abis':['arm64-v8a'],'nativeLibraries':native,'modelFilesVerified':len(files),'pointReadingUsesRealtimePiper':True,'builtinVocabularyEntries':content['combined']['uniqueEntries'],'builtinDecks':[{k:s[k] for k in ['name','entryCount','sha256']} for s in sources],'elfLoadAlignment':16384,'model':'en_US-lessac-high','runtime':'1.13.3'}
out=root/'validation';out.mkdir(exist_ok=True);(out/'apk-inspection.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report))
