from pathlib import Path
import hashlib,json,zipfile
root=Path(__file__).resolve().parents[1];out=root/'dist';out.mkdir(exist_ok=True)
version=json.loads((root/'extension'/'manifest.json').read_text(encoding='utf-8'))['version']
checksums=[]
for browser in ['firefox','chrome']:
    source=root/'build'/browser
    manifest=json.loads((source/'manifest.json').read_text(encoding='utf-8'))
    assert manifest['version']==version
    archive=out/f'RightSave-{version}-{browser}.zip'
    with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
        for p in sorted(source.rglob('*')):
            if p.is_file():z.write(p,p.relative_to(source).as_posix())
    with zipfile.ZipFile(archive) as z:
        assert z.testzip() is None and 'manifest.json' in z.namelist()
        assert not any(name.endswith(('.pem','.key')) for name in z.namelist())
    checksums.append(hashlib.sha256(archive.read_bytes()).hexdigest()+'  '+archive.name)
    print(f'{archive.name}: {archive.stat().st_size:,} bytes')
store=root/'store'
if (store/'assets'/'library-1280x800.png').exists():
    archive=out/f'RightSave-{version}-store-materials.zip'
    materials=[p for p in store.rglob('*') if p.is_file()]
    materials += [root/name for name in ['README.md','LICENSE','docs/privacy.html','docs/compatibility.html','docs/verification.json','scripts/sign-firefox.mjs']]
    with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
        for p in sorted(materials):z.write(p,p.relative_to(root).as_posix())
    with zipfile.ZipFile(archive) as z:assert z.testzip() is None
    checksums.append(hashlib.sha256(archive.read_bytes()).hexdigest()+'  '+archive.name)
    print(f'{archive.name}: {archive.stat().st_size:,} bytes (submission materials, not an extension)')
(out/'SHA256SUMS.txt').write_text('\n'.join(checksums)+'\n',encoding='utf-8')
