import re
import base64
import functools
import hashlib
import http.server
import json
import os
from pathlib import Path
import sys
import threading
import time
import zipfile
sys.stdout.reconfigure(encoding='utf-8')

ROOT = Path(__file__).resolve().parents[1]

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver import ActionChains
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.firefox.service import Service
from selenium.webdriver.support.ui import WebDriverWait
from PIL import Image

assets = ROOT / 'tests' / 'assets'
assets.mkdir(exist_ok=True)
downloads = ROOT / 'tests' / 'downloads'
downloads = downloads / str(int(time.time()))
downloads.mkdir(parents=True, exist_ok=True)
for name, color in [('image', '#5877cc'), ('background', '#a7b9eb'), ('pointer', '#6d64b8'), ('shadow', '#657b9a'), ('frame', '#295477'), ('original','#437a8a'), ('responsive','#6a57a4'), ('linked','#4a8b72')]:
    Image.new('RGB', (240,140), color).save(assets / (name + '.png'))
(assets / 'index.html').write_text((ROOT/'tests'/'fixture.html').read_text(), encoding='utf-8')
(assets / 'frame.html').write_text('<!doctype html><html><body><img src="/frame.png" width="240" height="140" alt="Frame image"></body></html>', encoding='utf-8')
(assets / 'playlist.m3u8').write_text('#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:10,\nsegment.ts\n', encoding='utf-8')

class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_): pass
    def end_headers(self):
        self.send_header('Cache-Control','no-store')
        super().end_headers()
    def do_GET(self):
        if self.path == '/slow.png':
            payload = (assets/'slow.png').read_bytes()
            self.send_response(200)
            self.send_header('Content-Type','image/png')
            self.send_header('Content-Length',str(len(payload)))
            self.end_headers()
            for offset in range(0,len(payload),65536):
                self.wfile.write(payload[offset:offset+65536]); self.wfile.flush(); time.sleep(.04)
            return
        if self.path == '/private.png':
            if 'rightsave-test=allowed' not in (self.headers.get('Cookie') or '') or self.headers.get('Referer') != base + '/':
                self.send_error(403)
                return
            payload = (assets/'image.png').read_bytes()
            self.send_response(200)
            self.send_header('Content-Type','image/png')
            self.end_headers()
            self.wfile.write(payload)
            return
        return super().do_GET()
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(assets)))
threading.Thread(target=server.serve_forever, daemon=True).start()
base = f'http://127.0.0.1:{server.server_port}'

archive = ROOT / 'tests' / 'rightsave-test.xpi'
source_hashes = {p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in (ROOT/'build'/'firefox').glob('*') if p.is_file()}
(ROOT/'tests'/'results.json').write_text(json.dumps({'status':'running'}),encoding='utf-8')
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as z:
    for path in (ROOT/'build'/'firefox').rglob('*'):
        if path.is_file(): z.write(path, path.relative_to(ROOT/'build'/'firefox').as_posix())

options = Options()
if os.environ.get('FIREFOX_BINARY'): options.binary_location = os.environ['FIREFOX_BINARY']
elif Path(r'C:\Program Files\Mozilla Firefox\firefox.exe').exists(): options.binary_location = r'C:\Program Files\Mozilla Firefox\firefox.exe'
options.add_argument('-headless')
options.set_preference('browser.download.folderList', 2)
options.set_preference('browser.download.dir', str(downloads))
options.set_preference('browser.download.useDownloadDir', True)
options.set_preference('browser.helperApps.neverAsk.saveToDisk', 'image/png,video/webm,application/octet-stream')
options.set_preference('media.autoplay.default', 0)
driver = webdriver.Firefox(options=options, service=Service(service_args=['--allow-system-access']))
driver.set_window_size(1280,1000)
wait = WebDriverWait(driver, 15)
checks = []
def check(name, condition):
    assert condition, name
    checks.append(name)
    print('PASS', name, flush=True)
def ext(script, *args):
    return driver.execute_async_script('const done=arguments[arguments.length-1]; (async()=>{' + script + '})().then(done,e=>done({error:e.message,stack:e.stack}));', *args)

try:
    addon = driver.install_addon(str(archive), temporary=True)
    driver.set_context('chrome')
    driver.execute_script((ROOT/'tests'/'file-picker.js').read_text(),str(downloads))
    uuids = json.loads(driver.execute_script("return Services.prefs.getStringPref('extensions.webextensions.uuids')"))
    uuid = uuids[addon]
    extension = f'moz-extension://{uuid}/'
    driver.set_context('content')
    driver.get(extension+'options.html')
    wait.until(lambda d:ext('return (await browser.tabs.query({})).some(t=>t.url===browser.runtime.getURL("welcome.html"));'))
    ext('await browser.tabs.remove((await browser.tabs.query({})).filter(t=>t.url===browser.runtime.getURL("welcome.html")).map(t=>t.id));return true;')
    driver.get(base)
    source_handle = driver.current_window_handle
    wait.until(lambda d: d.find_element(By.ID, 'overlay'))
    # Generate a real, local playable WebM without any external media dependency.
    video = driver.execute_async_script('''const done=arguments[arguments.length-1];const c=document.createElement('canvas');c.width=64;c.height=64;const ctx=c.getContext('2d');const stream=c.captureStream(10);const r=new MediaRecorder(stream,{mimeType:'video/webm'});const parts=[];r.ondataavailable=e=>parts.push(e.data);r.onstop=()=>{const f=new FileReader();f.onload=()=>done(f.result.split(',')[1]);f.readAsDataURL(new Blob(parts,{type:'video/webm'}));stream.getTracks().forEach(t=>t.stop())};r.start();let i=0;const timer=setInterval(()=>{ctx.fillStyle=i++%2?'red':'blue';ctx.fillRect(0,0,64,64)},80);setTimeout(()=>{clearInterval(timer);r.stop()},700);''')
    (assets/'video.webm').write_bytes(base64.b64decode(video))
    driver.refresh()
    driver.switch_to.new_window('tab')
    extension_handle = driver.current_window_handle
    driver.get(extension+'popup.html')
    ext('await browser.storage.local.set({quickSave:false,askWhere:false});return true;')
    driver.switch_to.window(source_handle)
    time.sleep(.1)
    ActionChains(driver).context_click(driver.find_element(By.ID,'overlay')).perform()
    time.sleep(.4)
    check('Website contextmenu and right-button handlers are blocked', driver.execute_script('return window.blocked===0 && window.down===0'))
    driver.set_context('chrome')
    labels = driver.execute_script("return [...document.querySelectorAll('#contentAreaContextMenu menu, #contentAreaContextMenu menuitem')].map(e=>({label:e.getAttribute('label'),disabled:e.getAttribute('disabled')}))")
    check('Native Firefox context menu contains RightSave', any(x['label']=='RightSave' for x in labels))
    driver.execute_script("document.getElementById('contentAreaContextMenu').hidePopup()")
    driver.set_context('content')
    driver.switch_to.window(extension_handle)
    result = ext('const tabs=await browser.tabs.query({});return tabs.filter(t=>t.url.startsWith(arguments[0])).map(t=>({id:t.id,url:t.url}));',base)
    tab_id = next(t['id'] for t in result if t['url'].rstrip('/')==base)
    items = ext('return await browser.tabs.sendMessage(arguments[0],{type:"context"},{frameId:0});',tab_id)
    check('Detects image underneath transparent overlay', any(i['url'].endswith('/image.png') for i in items))
    result = ext('return await browser.runtime.sendMessage({type:"browse",tabId:arguments[0]});',tab_id)
    check('Toolbar can open media picker through real background messaging', result=={'ok':True})
    wait.until(lambda d: len(d.window_handles)==3)
    picker_handle = driver.window_handles[-1]
    driver.switch_to.window(picker_handle)
    wait.until(lambda d: len(d.find_elements(By.CSS_SELECTOR,'.media-card'))>=7)
    check('Page scanner includes images, CSS backgrounds, canvas, shadow DOM and iframe',len(driver.find_elements(By.CSS_SELECTOR,'.media-card'))>=8)
    cards = [e.text for e in driver.find_elements(By.CSS_SELECTOR,'.media-card')]
    check('Streaming playlist is clearly marked', any('streaming playlist' in text for text in cards))
    check('Media from embedded frame is present', any('Frame image' in text for text in cards))
    driver.find_element(By.ID,'load-all').click()
    wait.until(lambda d: d.find_element(By.ID,'load-all').is_enabled())
    check('Load all fills image previews without starting downloads',len(driver.find_elements(By.CSS_SELECTOR,'.preview img'))>=5)
    check('Default thumbnails are larger than the original extension',driver.find_element(By.CSS_SELECTOR,'.preview').size['height']>=280)
    driver.find_element(By.CSS_SELECTOR,'[data-size=xl]').click()
    check('Extra-large thumbnail control increases preview size',driver.find_element(By.CSS_SELECTOR,'.preview').size['height']>=390)
    driver.find_element(By.CSS_SELECTOR,'[data-size=large]').click()
    driver.save_full_page_screenshot(str(ROOT/'tests'/'picker.png'))
    # A legacy auto-save preference must no longer bypass the location picker.
    ext('await browser.storage.local.set({askWhere:false});return true;')
    for source, expected in [('Under an overlay','image.png'), ('Video','video.webm'), ('Canvas','rightsave-image.png'), ('Inline data image','rightsave-image*.png'), ('Temporary blob image','rightsave-image*.png')]:
        matches = driver.find_elements(By.CSS_SELECTOR,'.media-card')
        card = next(e for e in matches if (source in e.text and ('streaming playlist' not in e.text)))
        before = len(list(downloads.glob('*')))
        card.find_element(By.CSS_SELECTOR,'button.primary').click()
        try:
            wait.until(lambda d: card.find_element(By.CSS_SELECTOR,'button.primary').is_enabled())
            check(f'{source} save request accepted', 'Sent to browser Downloads' in card.text)
        except Exception:
            print('FAILED CARD:', card.text, flush=True)
            print('BACKGROUND:',ext('const bg=await browser.runtime.getBackgroundPage();return {exists:!!bg};'),flush=True)
            raise
        wait.until(lambda d: len(list(downloads.glob('*'))) > before)
        wait.until(lambda d: not list(downloads.glob('*.part')))
        wait.until(lambda d: ext('return (await browser.downloads.search({orderBy:["-startTime"],limit:1}))[0]?.state;')=='complete')
        found = [Path(ext('return (await browser.downloads.search({orderBy:["-startTime"],limit:1}))[0].filename;'))]
        check(f'{source} filename is random', bool(re.fullmatch(r'[a-f0-9]{32}\.(png|webm)',found[0].name)))
        check(f'Real {source.lower()} download completes',bool(found) and found[0].stat().st_size>0)
        if source in ['Under an overlay','Video']:
            check(f'{source} saved bytes match the original',found[0].read_bytes()==(assets/expected).read_bytes())
    driver.find_element(By.CSS_SELECTOR,'button[data-filter="video"]').click()
    check('Video filter excludes image files',all('Save video' in e.text for e in driver.find_elements(By.CSS_SELECTOR,'.media-card')))
    driver.find_element(By.ID,'rescan').click()
    wait.until(lambda d: d.find_element(By.ID,'rescan').is_enabled())
    check('Rescan updates picker without losing source tab',len(driver.find_elements(By.CSS_SELECTOR,'.media-card'))==2)
    driver.switch_to.window(source_handle)
    driver.add_cookie({'name':'rightsave-test','value':'allowed'})
    driver.switch_to.window(extension_handle)
    auth = ext('return await browser.runtime.sendMessage({type:"save",tabId:arguments[0],item:{url:arguments[1]+"/private.png",pageURL:arguments[1]+"/",kind:"image"}});',tab_id,base)
    check('Authenticated download starts', 'id' in auth)
    wait.until(lambda d: ext('return (await browser.downloads.search({id:arguments[0]}))[0]?.state;',auth['id'])=='complete')
    check('Authenticated download preserves cookies and referrer',Path(ext('return (await browser.downloads.search({id:arguments[0]}))[0].filename;',auth['id'])).read_bytes()==(assets/'image.png').read_bytes())
    driver.switch_to.window(source_handle)
    ActionChains(driver).context_click(driver.find_element(By.ID,'pointer')).perform()
    driver.set_context('chrome')
    driver.execute_script("document.getElementById('contentAreaContextMenu').hidePopup()")
    driver.set_context('content')
    driver.switch_to.window(extension_handle)
    pointer = ext('return await browser.tabs.sendMessage(arguments[0],{type:"context"},{frameId:0});',tab_id)
    check('Detects images with pointer-events disabled',any(i['url'].endswith('/pointer.png') for i in pointer))
    driver.switch_to.window(source_handle)
    ActionChains(driver).context_click(driver.find_element(By.ID,'overlay')).perform()
    time.sleep(.25)
    driver.set_context('chrome')
    native = driver.execute_script("const item=[...document.querySelectorAll('#contentAreaContextMenu menuitem')].find(e=>e.getAttribute('label')==='Save detected image…');const enabled=!!item&&!item.disabled;if(enabled)item.doCommand();document.getElementById('contentAreaContextMenu').hidePopup();return enabled;")
    check('Native right-click Save detected image action is enabled and activates',native)
    driver.set_context('content')
    wait.until(lambda d: len(list(downloads.glob('*.png')))>=2 and not list(downloads.glob('*.part')))
    check('Native right-click command downloads the underlying image',len(list(downloads.glob('*.png')))>=2)
    ActionChains(driver).context_click(driver.find_element(By.ID,'video')).perform()
    time.sleep(.25)
    driver.set_context('chrome')
    native_video = driver.execute_script("const item=[...document.querySelectorAll('#contentAreaContextMenu menuitem')].find(e=>e.getAttribute('label')==='Save detected video…');const enabled=!!item&&!item.disabled;if(enabled)item.doCommand();document.getElementById('contentAreaContextMenu').hidePopup();return enabled;")
    check('Native right-click Save detected video action activates',native_video)
    driver.set_context('content')
    wait.until(lambda d: len(list(downloads.glob('*.webm')))>=2 and not list(downloads.glob('*.part')))
    driver.switch_to.window(extension_handle)
    wait.until(lambda d: ext('return (await browser.downloads.search({orderBy:["-startTime"],limit:1}))[0]?.state;')=='complete')
    check('Native right-click video command saves the complete video',all(p.read_bytes()==(assets/'video.webm').read_bytes() for p in downloads.glob('*.webm')))
    driver.switch_to.window(extension_handle)
    ext('await browser.storage.local.set({disabledSites:["127.0.0.1"]});return true;')
    driver.switch_to.window(source_handle)
    time.sleep(.2)
    ActionChains(driver).context_click(driver.find_element(By.ID,'overlay')).perform()
    check('Site toggle gives website its own right-click back',driver.execute_script('return window.blocked>0 && window.down>0'))
    driver.switch_to.window(extension_handle)
    ext('await browser.storage.local.set({disabledSites:[],quickSave:true});return true;')
    driver.set_context('chrome')
    calls_before = driver.execute_script('return window.__rightSavePickerCalls.length')
    check('All saves invoked Firefox Save As despite a legacy askWhere:false setting', calls_before>=8 and driver.execute_script('return window.__rightSavePickerCalls.every(c=>c.mode===Ci.nsIFilePicker.modeSave)'))
    driver.execute_script('window.__rightSaveHoldNext=true')
    driver.set_context('content')
    driver.switch_to.window(source_handle)
    time.sleep(.1)
    ActionChains(driver).context_click(driver.find_element(By.ID,'overlay')).perform()
    ActionChains(driver).context_click(driver.find_element(By.ID,'overlay')).perform()
    driver.set_context('chrome')
    wait.until(lambda d: driver.execute_script('return !!window.__rightSavePendingPicker'))
    check('Right-click opens one location picker directly, including repeated clicks',driver.execute_script('return window.__rightSavePickerCalls.length')==calls_before+1)
    check('Direct-save right-click does not also open the native context menu',driver.execute_script("return document.getElementById('contentAreaContextMenu').state==='closed'"))
    driver.execute_script('window.__rightSavePendingPicker();window.__rightSavePendingPicker=null')
    driver.set_context('content')
    driver.switch_to.window(extension_handle)
    wait.until(lambda d: ext('return (await browser.downloads.search({orderBy:["-startTime"],limit:1}))[0]?.state;')=='complete')
    check('Chosen location receives one completed image with original bytes',len([p for p in downloads.glob('*.png') if p.read_bytes()==(assets/'image.png').read_bytes()])>=3)
    driver.set_context('chrome')
    video_picker_before = driver.execute_script('return window.__rightSavePickerCalls.length')
    driver.set_context('content')
    driver.switch_to.window(source_handle)
    ActionChains(driver).context_click(driver.find_element(By.ID,'video')).perform()
    driver.set_context('chrome')
    wait.until(lambda d: driver.execute_script('return window.__rightSavePickerCalls.length')==video_picker_before+1)
    chosen_video_name = driver.execute_script('return window.__rightSavePickerCalls.at(-1).name')
    check('Right-click video opens Save As directly',bool(re.fullmatch(r'[a-f0-9]{32}\.webm',chosen_video_name)))
    driver.set_context('content')
    driver.switch_to.window(extension_handle)
    wait.until(lambda d: len(list(downloads.glob('*.webm')))>=3 and ext('return (await browser.downloads.search({orderBy:["-startTime"],limit:1}))[0]?.state;')=='complete')
    check('Direct right-click video saves exactly the original file',all(p.read_bytes()==(assets/'video.webm').read_bytes() for p in downloads.glob('*.webm')))
    driver.set_context('chrome')
    driver.execute_script('window.__rightSaveCancelNext=true')
    driver.set_context('content')
    driver.switch_to.window(source_handle)
    ActionChains(driver).context_click(driver.find_element(By.ID,'overlay')).perform()
    driver.switch_to.window(extension_handle)
    time.sleep(.4)
    check('Canceling Save As creates no error tab',len(driver.window_handles)==3)
    # Slow HTTP transfer: one browser download may temporarily have a .part file
    # and a placeholder; completion must leave exactly one valid final file.
    Image.new('RGB',(1000,1000),'#123456').save(assets/'slow.png',compress_level=0)
    concurrent = ext('const m={type:"save",tabId:arguments[0],item:{url:arguments[1]+"/slow.png",pageURL:arguments[1]+"/",kind:"image"}};return await Promise.all([browser.runtime.sendMessage(m),browser.runtime.sendMessage(m)]);',tab_id,base)
    check('Concurrent requests share a single download',concurrent[0].get('id') is not None and concurrent[0]==concurrent[1])
    slow_id = concurrent[0]['id']
    in_progress = ext('return (await browser.downloads.search({id:arguments[0]}))[0]?.state;',slow_id)
    check('Slow transfer has one in-progress browser download',in_progress=='in_progress')
    wait.until(lambda d: bool(list(downloads.glob('*.part'))))
    check('Firefox temporary .part is present while downloading',bool(list(downloads.glob('*.part'))))
    repeat = ext('return await browser.runtime.sendMessage({type:"save",tabId:arguments[0],item:{url:arguments[1]+"/slow.png",pageURL:arguments[1]+"/",kind:"image"}});',tab_id,base)
    check('Repeated save during transfer reuses that download',repeat.get('id')==slow_id)
    wait.until(lambda d: ext('return (await browser.downloads.search({id:arguments[0]}))[0]?.state;',slow_id)=='complete')
    check('Slow transfer leaves one final file and no partial files',not list(downloads.glob('*.part')) and Path(ext('return (await browser.downloads.search({id:arguments[0]}))[0].filename;',slow_id)).read_bytes()==(assets/'slow.png').read_bytes() and len([p for p in downloads.glob('*.png') if p.read_bytes()==(assets/'slow.png').read_bytes()])==1)
    driver.refresh()
    driver.save_screenshot(str(ROOT/'tests'/'popup.png'))
    print(json.dumps({'checks':len(checks),'firefox':driver.capabilities['browserVersion'],'passed':checks},indent=2),flush=True)
    (ROOT/'tests'/'results.json').write_text(json.dumps({'status':'passed','version':json.loads((ROOT/'build'/'firefox'/'manifest.json').read_text())['version'],'source_sha256':source_hashes,'checks':len(checks),'firefox':driver.capabilities['browserVersion'],'passed':checks},indent=2),encoding='utf-8')
finally:
    driver.quit()
    server.shutdown()
