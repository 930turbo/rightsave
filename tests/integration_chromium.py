"""Chromium MV3 integration. Save As options are recorded; the test alone
substitutes automatic destinations so headless tests cannot strand OS dialogs."""
import functools,http.server,json,os,sys,threading,time,urllib.request,shutil,subprocess,zipfile
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver import ActionChains
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait
import websocket
sys.stdout.reconfigure(encoding='utf-8')
root=Path(__file__).resolve().parents[1]
assets=root/'tests'/'assets'
assert (assets/'video.webm').exists(),'Run integration_firefox.py first to generate local fixture media.'
downloads=root/'tests'/'downloads'/('chromium-'+str(int(time.time())));downloads.mkdir(parents=True)
class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*_):pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(assets)))
threading.Thread(target=server.serve_forever,daemon=True).start();base=f'http://127.0.0.1:{server.server_port}'
options=Options()
if os.environ.get('CHROMIUM_BINARY'):options.binary_location=str(Path(os.environ['CHROMIUM_BINARY']).resolve())
options.add_argument('--headless=new');options.add_argument('--remote-allow-origins=*')
test_extension=assets/'chrome5-extension';shutil.copytree(root/'build'/'chrome',test_extension,dirs_exist_ok=True)
manifest=json.loads((test_extension/'manifest.json').read_text());manifest['permissions'].append('webRequest');manifest.pop('optional_permissions',None)
(test_extension/'manifest.json').write_text(json.dumps(manifest))
options.add_argument('--load-extension='+str(test_extension))
options.add_argument('--disable-extensions-except='+str(test_extension))
options.add_experimental_option('prefs',{'download.default_directory':str(downloads),'download.prompt_for_download':False})
options.add_experimental_option('enableExtensionTargets',True)
driver=webdriver.Chrome(options=options);driver.set_window_size(1440,1100);wait=WebDriverWait(driver,20);checks=[]
(root/'tests'/'results-chromium.json').write_text(json.dumps({'status':'running'}))
driver.execute_cdp_cmd('Browser.setDownloadBehavior',{'behavior':'allow','downloadPath':str(downloads),'eventsEnabled':True})
def check(name,condition):assert condition,name;checks.append(name);print('PASS',name,flush=True)
def ext(script,*args):return driver.execute_async_script('const done=arguments[arguments.length-1];(async()=>{'+script+'})().then(done,e=>done({error:e.message}));',*args)
try:
    debug=driver.capabilities['goog:chromeOptions']['debuggerAddress']
    def targets():return json.load(urllib.request.urlopen('http://'+debug+'/json'))
    wait.until(lambda d:any(t['type']=='service_worker' for t in targets()))
    worker=next(t for t in targets() if t['type']=='service_worker' and '/worker.js' in t['url'])
    extension=worker['url'].rsplit('/',1)[0]+'/'
    ws=websocket.create_connection(worker['webSocketDebuggerUrl'],suppress_origin=True);serial=0
    def evaluate(expression):
        global serial
        serial+=1;ws.send(json.dumps({'id':serial,'method':'Runtime.evaluate','params':{'expression':expression,'awaitPromise':True,'returnByValue':True}}))
        while True:
            value=json.loads(ws.recv())
            if value.get('id')==serial:return value.get('result',{}).get('result',{}).get('value')
    evaluate("globalThis.__saveCalls=[];globalThis.__downloadIDs=[];const actualDownload=chrome.downloads.download.bind(chrome.downloads);chrome.downloads.download=async options=>{__saveCalls.push({...options});const id=await actualDownload({...options,saveAs:false});__downloadIDs.push(id);return id;};true")
    driver.get(extension+'options.html')
    wait.until(lambda d:ext('return (await browser.tabs.query({})).some(t=>t.url===browser.runtime.getURL("welcome.html"));'))
    ext('await browser.tabs.remove((await browser.tabs.query({})).filter(t=>t.url===browser.runtime.getURL("welcome.html")).map(t=>t.id));return true;')
    driver.execute_cdp_cmd('Browser.setDownloadBehavior',{'behavior':'allow','downloadPath':str(downloads),'eventsEnabled':True})
    driver.get(base);source=driver.current_window_handle
    driver.switch_to.new_window('tab');ui=driver.current_window_handle;driver.get(extension+'options.html')
    ext('await browser.storage.local.set({quickSave:false});return true;')
    tabs=ext('return await browser.tabs.query({});');tabid=next(t['id'] for t in tabs if t.get('url','').rstrip('/')==base)
    driver.switch_to.window(source);time.sleep(.1)
    ActionChains(driver).context_click(driver.find_element(By.ID,'overlay')).perform()
    check('Chrome content script restores blocked right-click',driver.execute_script('return window.blocked===0'))
    ActionChains(driver).send_keys(Keys.ESCAPE).perform()
    driver.switch_to.window(ui)
    before_handles=set(driver.window_handles)
    result=ext('return await browser.runtime.sendMessage({type:"browse",tabId:arguments[0]});',tabid)
    check('Chrome service worker opens media library',result.get('ok') is True)
    wait.until(lambda d:bool(set(d.window_handles)-before_handles));driver.switch_to.window(next(iter(set(driver.window_handles)-before_handles)))
    wait.until(lambda d:len(d.find_elements(By.CSS_SELECTOR,'.media-card'))>=8)
    driver.execute_cdp_cmd('Browser.setDownloadBehavior',{'behavior':'allow','downloadPath':str(downloads),'eventsEnabled':True})
    check('Chrome detects backgrounds, frames, canvas and images',len(driver.find_elements(By.CSS_SELECTOR,'.media-card'))>=8)
    driver.find_element(By.ID,'load-all').click();wait.until(lambda d:d.find_element(By.ID,'load-all').is_enabled())
    check('Chrome Load all renders larger thumbnails',len(driver.find_elements(By.CSS_SELECTOR,'.preview img'))>=5 and driver.find_element(By.CSS_SELECTOR,'.preview').size['height']>=280)
    saved_files={}
    for label,filename in [('Under an overlay','image.png'),('Video','video.webm'),('Canvas','rightsave-image.png')]:
        card=next(e for e in driver.find_elements(By.CSS_SELECTOR,'.media-card') if label in e.text and 'streaming playlist' not in e.text)
        card.find_element(By.CSS_SELECTOR,'button.primary').click()
        try:wait.until(lambda d:'Sent to browser Downloads' in card.text)
        except Exception:
            print('FAILED SAVE STATUS',card.text,flush=True)
            print('SAVE CALLS',evaluate('__saveCalls.map(c=>({url:c.url.slice(0,80),saveAs:c.saveAs,filename:c.filename}))'),flush=True)
            print('DOWNLOAD STATES',ext('return (await browser.downloads.search({})).map(d=>({state:d.state,error:d.error,filename:d.filename}));'),flush=True)
            raise
        wait.until(lambda d:ext('return (await browser.downloads.search({orderBy:["-startTime"],limit:1}))[0]?.state;')=='complete')
        actual=Path(ext('return (await browser.downloads.search({orderBy:["-startTime"],limit:1}))[0].filename;'))
        saved_files[label]=actual
        check('Chrome saves '+label.lower(),actual.exists() and actual.stat().st_size>0)
    check('Chrome image/video bytes match their originals',saved_files['Under an overlay'].read_bytes()==(assets/'image.png').read_bytes() and saved_files['Video'].read_bytes()==(assets/'video.webm').read_bytes())
    check('Chrome uses valid MV3 download options and always requests Save As',evaluate('__saveCalls.every(c=>c.saveAs===true&&!Object.hasOwn(c,"cookieStoreId")&&!Object.hasOwn(c,"incognito")&&!Object.hasOwn(c,"headers"))'))
    driver.find_element(By.ID,'quick-toggle').click()
    check('Gallery toggle enables direct right-click saving',ext('return (await browser.storage.local.get("quickSave")).quickSave;') is True)
    driver.switch_to.window(source);time.sleep(.2);ActionChains(driver).context_click(driver.find_element(By.ID,'overlay')).perform()
    driver.switch_to.window(ui);wait.until(lambda d:evaluate('__saveCalls.length')==4)
    wait.until(lambda d:ext('return (await browser.downloads.search({orderBy:["-startTime"],limit:1}))[0]?.state;')=='complete')
    check('Chrome right-click directly starts one Save As operation',evaluate('__saveCalls.length')==4)
    library=next(h for h in driver.window_handles if h not in [source,ui]);driver.switch_to.window(library)
    check('Lazy, responsive and linked originals appear in the library',all(any(term in card.text for card in driver.find_elements(By.CSS_SELECTOR,'.media-card')) for term in ['Lazy/original image','Responsive image','Linked original']))
    svg=next(e for e in driver.find_elements(By.CSS_SELECTOR,'.media-card') if 'Fixture vector' in e.text);svg.find_element(By.CSS_SELECTOR,'button.primary').click()
    wait.until(lambda d:'Sent to browser Downloads' in svg.text);wait.until(lambda d:ext('return (await browser.downloads.search({orderBy:["-startTime"],limit:1}))[0]?.state;')=='complete')
    svg_file=Path(ext('return (await browser.downloads.search({orderBy:["-startTime"],limit:1}))[0].filename;'));svg_text=svg_file.read_text()
    check('SVG export saves vector markup with event handlers removed','<svg' in svg_text and 'onclick' not in svg_text)
    check('SVG export removes external links, styles and animation while keeping local shapes','example.invalid' not in svg_text and '<style' not in svg_text and '<animate' not in svg_text and 'href="#safe-shape"' in svg_text)
    driver.switch_to.window(source);driver.execute_script("document.getElementById('video').play();")
    wait.until(lambda d:driver.execute_script("return document.getElementById('video').readyState>=2"));driver.switch_to.window(library)
    video=next(e for e in driver.find_elements(By.CSS_SELECTOR,'.media-card') if 'video.webm' in e.text and 'Detected video request' not in e.text)
    video.find_element(By.CSS_SELECTOR,'.text-button').click();wait.until(lambda d:'Sent to browser Downloads' in video.text)
    wait.until(lambda d:ext('return (await browser.downloads.search({orderBy:["-startTime"],limit:1}))[0]?.state;')=='complete')
    frame_file=Path(ext('return (await browser.downloads.search({orderBy:["-startTime"],limit:1}))[0].filename;'))
    check('Unprotected video frame exports as PNG',frame_file.read_bytes().startswith(b'\x89PNG'))
    driver.find_element(By.CSS_SELECTOR,'#library-tools > summary').click()
    for label in ['Under an overlay','Canvas']:
        card=next(e for e in driver.find_elements(By.CSS_SELECTOR,'.media-card') if label in e.text);card.find_element(By.CSS_SELECTOR,'.tile-select input').click()
    driver.find_element(By.CSS_SELECTOR,'.naming summary').click();driver.find_element(By.ID,'template').send_keys('batch/{name}-{index}.{ext}')
    driver.find_element(By.ID,'save-selected').click();wait.until(lambda d:'2 files sent to Downloads' in d.find_element(By.ID,'notice').text)
    wait.until(lambda d:ext('return (await browser.downloads.search({orderBy:["-startTime"],limit:2})).every(d=>d.state==="complete");'))
    check('Selected-file batch requests safe naming and subfolder templates',evaluate('__saveCalls.slice(-2).map(c=>c.filename)')==['batch/image-001.png','batch/rightsave-image-002.png'])
    driver.find_element(By.ID,'export').click();wait.until(lambda d:ext('return (await browser.downloads.search({orderBy:["-startTime"],limit:1}))[0]?.mime;')=='application/json')
    wait.until(lambda d:ext('return (await browser.downloads.search({orderBy:["-startTime"],limit:1}))[0]?.state;')=='complete')
    export_file=Path(ext('return (await browser.downloads.search({orderBy:["-startTime"],limit:1}))[0].filename;'))
    check('Media manifest export is valid JSON',len(json.loads(export_file.read_text())['media'])>=8)
    driver.find_element(By.ID,'save-zip').click();wait.until(lambda d:'2 files packaged' in d.find_element(By.ID,'archive-status').text)
    wait.until(lambda d:ext('return (await browser.downloads.search({orderBy:["-startTime"],limit:1}))[0]?.state;')=='complete')
    zip_file=Path(ext('return (await browser.downloads.search({orderBy:["-startTime"],limit:1}))[0].filename;'))
    with zipfile.ZipFile(zip_file) as archive:
        check('Free ZIP export packages selected files and naming rules',archive.testzip() is None and archive.namelist()==['batch/image-001.png','batch/rightsave-image-002.png'] and archive.read('batch/image-001.png')==(assets/'image.png').read_bytes())
    before=evaluate('__saveCalls.length')
    driver.execute_script('document.getElementById("save-zip").click();document.getElementById("cancel-zip").click();')
    wait.until(lambda d:'canceled' in d.find_element(By.ID,'archive-status').text)
    check('Canceling archive preparation creates no partial download',evaluate('__saveCalls.length')==before)
    driver.find_element(By.CSS_SELECTOR,'#workflow-tools > summary').click();driver.find_element(By.ID,'preset-name').send_keys('My references');driver.find_element(By.ID,'save-preset').click()
    wait.until(lambda d:'Workflow saved' in d.find_element(By.ID,'notice').text)
    driver.find_element(By.ID,'search').send_keys('Canvas');driver.find_element(By.ID,'apply-preset').click()
    wait.until(lambda d:'Workflow applied' in d.find_element(By.ID,'notice').text)
    check('Free workflow presets persist and restore library settings',driver.find_element(By.ID,'search').get_attribute('value')=='' and len(ext('return (await browser.storage.local.get("workflowPresets")).workflowPresets;'))==1)
    driver.find_element(By.ID,'delete-preset').click();wait.until(lambda d:'Workflow removed' in d.find_element(By.ID,'notice').text)
    check('Saved workflows can be deleted',len(ext('return (await browser.storage.local.get("workflowPresets")).workflowPresets;'))==0)
    available=ext('return await browser.runtime.sendMessage({type:"archive-source",tabId:arguments[0],item:{url:"https://example.org/a.png",kind:"image"}});',tabid)
    check('Collection access needs no key or account',available.get('url')=='https://example.org/a.png')
    driver.switch_to.window(source);driver.execute_script("document.getElementById('video').remove();")
    driver.switch_to.window(library);driver.find_element(By.ID,'rescan').click();wait.until(lambda d:d.find_element(By.ID,'rescan').is_enabled())
    recovered=any('Detected video request' in e.text and 'video.webm' in e.text for e in driver.find_elements(By.CSS_SELECTOR,'.media-card'))
    check('Optional network detection recovers a video URL absent from the DOM',recovered)
    ws.close()
    result={'status':'passed','browser':driver.capabilities['browserVersion'],'checks':len(checks),'passed':checks}
    (root/'tests'/'results-chromium.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))
finally:driver.quit();server.shutdown()
