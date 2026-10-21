"""Real-browser free collection, conversion and workflow integration.
No merchant requests or credentials. Native Save As is recorded then automated.
"""
from pathlib import Path
import argparse,functools,http.server,json,os,shutil,sys,threading,time,urllib.request,zipfile
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
sys.stdout.reconfigure(encoding='utf-8')
parser=argparse.ArgumentParser();parser.add_argument('--browser',choices=['chrome','firefox'],default='chrome');target=parser.parse_args().browser
root=Path(__file__).resolve().parents[1];assets=root/'tests'/'assets';test_extension=assets/('collections-'+target)
shutil.copytree(root/'build'/target,test_extension,dirs_exist_ok=True)
downloads=root/'tests'/'downloads'/('collections-'+target+'-'+str(time.time_ns()));downloads.mkdir(parents=True)
class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*_):pass
    def do_GET(self):
        if self.path=='/duplicate.png':
            payload=(root/'docs/demo/coast-photo.png').read_bytes();self.send_response(200);self.send_header('Content-Type','image/png');self.end_headers();self.wfile.write(payload);return
        return super().do_GET()
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(root/'docs'/'demo')))
threading.Thread(target=server.serve_forever,daemon=True).start();base=f'http://127.0.0.1:{server.server_port}'
if target=='firefox':
    from selenium.webdriver.firefox.options import Options
    from selenium.webdriver.firefox.service import Service
    options=Options();options.add_argument('-headless');options.binary_location=os.environ.get('FIREFOX_BINARY',r'C:\Program Files\Mozilla Firefox\firefox.exe')
    driver=webdriver.Firefox(options=options,service=Service(service_args=['--allow-system-access']))
else:
    from selenium.webdriver.chrome.options import Options
    options=Options();options.add_argument('--headless=new');options.add_argument('--remote-allow-origins=*')
    if os.environ.get('CHROMIUM_BINARY'):options.binary_location=str(Path(os.environ['CHROMIUM_BINARY']).resolve())
    options.add_argument('--load-extension='+str(test_extension));options.add_argument('--disable-extensions-except='+str(test_extension));options.add_experimental_option('enableExtensionTargets',True)
    options.add_experimental_option('prefs',{'download.default_directory':str(downloads),'download.prompt_for_download':False})
    driver=webdriver.Chrome(options=options)
driver.set_window_size(1440,1100);wait=WebDriverWait(driver,20);checks=[]
result_path=root/'tests'/('results-collections-'+target+'.json');result_path.write_text(json.dumps({'status':'running'}))
def ext(script,*args):return driver.execute_async_script('const done=arguments[arguments.length-1];(async()=>{'+script+'})().then(done,e=>done({error:e.message}));',*args)
def check(name,condition):assert condition,name;checks.append(name);print('PASS',name,flush=True)
try:
    if target=='firefox':
        archive=assets/'collections-test.xpi'
        with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
            for p in test_extension.rglob('*'):
                if p.is_file():z.write(p,p.relative_to(test_extension).as_posix())
        addon=driver.install_addon(str(archive),temporary=True);driver.set_context('chrome');uuid=json.loads(driver.execute_script("return Services.prefs.getStringPref('extensions.webextensions.uuids')"))[addon]
        driver.execute_script((root/'tests'/'file-picker.js').read_text(),str(downloads));driver.set_context('content');extension=f'moz-extension://{uuid}/'
    else:
        import websocket
        debug=driver.capabilities['goog:chromeOptions']['debuggerAddress']
        def workers():return [t for t in json.load(urllib.request.urlopen('http://'+debug+'/json')) if t['type']=='service_worker' and t['url'].endswith('/worker.js')]
        wait.until(lambda d:workers());worker=workers()[0];extension=worker['url'].rsplit('/',1)[0]+'/'
        ws=websocket.create_connection(worker['webSocketDebuggerUrl'],suppress_origin=True)
        ws.send(json.dumps({'id':1,'method':'Runtime.evaluate','params':{'expression':'globalThis.__saveCalls=[];const nativeDownload=chrome.downloads.download.bind(chrome.downloads);chrome.downloads.download=async options=>{__saveCalls.push(options);return await nativeDownload({...options,saveAs:false});};true','returnByValue':True}}))
        while json.loads(ws.recv()).get('id')!=1:pass
    driver.get(extension+'support.html');ui=driver.current_window_handle
    wait.until(lambda d:ext('return (await browser.tabs.query({})).some(t=>t.url===browser.runtime.getURL("welcome.html"));'))
    ext('await browser.tabs.remove((await browser.tabs.query({})).filter(t=>t.url===browser.runtime.getURL("welcome.html")).map(t=>t.id));return true;')
    if target=='chrome':driver.execute_cdp_cmd('Browser.setDownloadBehavior',{'behavior':'allow','downloadPath':str(downloads),'eventsEnabled':True})
    driver.switch_to.new_window('tab');driver.get(base);driver.switch_to.window(ui)
    tab=next(t for t in ext('return await browser.tabs.query({});') if t.get('url','').rstrip('/')==base)
    before=set(driver.window_handles);ext('return await browser.runtime.sendMessage({type:"browse",tabId:arguments[0]});',tab['id']);wait.until(lambda d:bool(set(d.window_handles)-before));driver.switch_to.window(next(iter(set(driver.window_handles)-before)))
    wait.until(lambda d:len(d.find_elements(By.CSS_SELECTOR,'.media-card'))==3)
    driver.find_element(By.CSS_SELECTOR,'#library-tools > summary').click();check('All collection controls are available without an account',driver.find_element(By.ID,'source-records').is_enabled());driver.find_element(By.ID,'select-visible').click();driver.find_element(By.ID,'source-records').click();driver.find_element(By.ID,'save-zip').click()
    wait.until(lambda d:'3 files packaged' in driver.find_element(By.ID,'archive-status').text)
    wait.until(lambda d:ext('return (await browser.downloads.search({orderBy:["-startTime"],limit:1}))[0]?.state;')=='complete')
    saved=Path(ext('return (await browser.downloads.search({orderBy:["-startTime"],limit:1}))[0].filename;'))
    with zipfile.ZipFile(saved) as z:
        record=json.loads(z.read('_rightsave/sources.json'))
        check('Native ZIP contains three exact photos and both source records',z.testzip() is None and len(z.namelist())==5 and z.read('coast-photo.png')==(root/'docs/demo/coast-photo.png').read_bytes() and '_rightsave/sources.csv' in z.namelist())
        check('Source records match archive filenames and the source page',len(record['files'])==3 and all(row['filename'] in z.namelist() and row['page'].startswith(base) for row in record['files']))
    driver.find_element(By.ID,'load-all').click();wait.until(lambda d:driver.find_element(By.ID,'load-all').is_enabled())
    driver.find_element(By.CSS_SELECTOR,'.preview img').click();wait.until(lambda d:driver.find_element(By.ID,'zoom').get_attribute('open'))
    driver.find_element(By.CSS_SELECTOR,'#convert-tools > summary').click()
    from selenium.webdriver.support.ui import Select
    Select(driver.find_element(By.ID,'convert-format')).select_by_value('image/webp');Select(driver.find_element(By.ID,'convert-size')).select_by_value('1024')
    driver.find_element(By.ID,'convert-save').click();wait.until(lambda d:'Converted 1024' in driver.find_element(By.ID,'zoom-status').text)
    wait.until(lambda d:ext('return (await browser.downloads.search({orderBy:["-startTime"],limit:1}))[0]?.state;')=='complete')
    converted=Path(ext('return (await browser.downloads.search({orderBy:["-startTime"],limit:1}))[0].filename;'))
    from PIL import Image
    with Image.open(converted) as image:check('Still-image conversion and resizing produce an actual WebP locally',image.format=='WEBP' and image.size==(1024,683))
    driver.find_element(By.ID,'close-zoom').click()
    library_handle=driver.current_window_handle
    source_handle=next(h for h in driver.window_handles if h not in [ui,library_handle]);driver.switch_to.window(source_handle)
    driver.execute_script('const img=new Image();img.src="/duplicate.png";img.alt="Duplicate coast";document.body.append(img);')
    wait.until(lambda d:driver.execute_script('return document.images[document.images.length-1].complete'))
    driver.switch_to.window(library_handle);driver.find_element(By.ID,'rescan').click();wait.until(lambda d:len(driver.find_elements(By.CSS_SELECTOR,'.media-card'))==4)
    driver.find_element(By.ID,'select-visible').click();driver.find_element(By.ID,'dedupe-zip').click();driver.find_element(By.ID,'save-zip').click()
    wait.until(lambda d:'1 duplicate skipped' in driver.find_element(By.ID,'archive-status').text)
    wait.until(lambda d:ext('return (await browser.downloads.search({orderBy:["-startTime"],limit:1}))[0]?.state;')=='complete')
    unique=Path(ext('return (await browser.downloads.search({orderBy:["-startTime"],limit:1}))[0].filename;'))
    with zipfile.ZipFile(unique) as z:check('ZIP duplicate removal compares actual bytes across different URLs',len(z.namelist())==5 and len(json.loads(z.read('_rightsave/sources.json'))['files'])==3)
    driver.find_element(By.CSS_SELECTOR,'#workflow-tools > summary').click();driver.find_element(By.ID,'preset-name').send_keys('Shared collection');driver.find_element(By.ID,'save-preset').click();wait.until(lambda d:'Workflow saved' in driver.find_element(By.ID,'notice').text)
    # The shared-controls disclosure follows workflow-tools.
    driver.find_element(By.ID,'export-pack').find_element(By.XPATH,'ancestor::details[1]').find_element(By.TAG_NAME,'summary').click()
    if target=='chrome':driver.execute_cdp_cmd('Browser.setDownloadBehavior',{'behavior':'allow','downloadPath':str(downloads),'eventsEnabled':True})
    driver.find_element(By.ID,'export-pack').click();wait.until(lambda d:'Workflow pack sent' in driver.find_element(By.ID,'notice').text)
    wait.until(lambda d:ext('return (await browser.downloads.search({orderBy:["-startTime"],limit:1}))[0]?.state;')=='complete')
    pack=Path(ext('return (await browser.downloads.search({orderBy:["-startTime"],limit:1}))[0].filename;'))
    check('Workflow pack saves the actual local workflow',json.loads(pack.read_text())['workflows'][0]['name']=='Shared collection')
    ext('await browser.storage.local.set({workflowPresets:[]});return true;');driver.find_element(By.ID,'pack-file').send_keys(str(pack));wait.until(lambda d:'Imported 1' in driver.find_element(By.ID,'notice').text)
    check('File import restores a portable workflow without uploading it',ext('return (await browser.storage.local.get("workflowPresets")).workflowPresets[0].name;')=='Shared collection')
    result_path.write_text(json.dumps({'status':'passed','checks':len(checks),'passed':checks,'browser':driver.capabilities['browserVersion']},indent=2))
finally:driver.quit();server.shutdown()
