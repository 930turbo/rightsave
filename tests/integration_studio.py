"""Real-browser Studio and billing integration using a deterministic provider.
No merchant requests or credentials. Native Save As is recorded then automated.
"""
from pathlib import Path
import argparse,functools,http.server,json,os,shutil,sys,threading,time,urllib.request,zipfile
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
sys.stdout.reconfigure(encoding='utf-8')
parser=argparse.ArgumentParser();parser.add_argument('--browser',choices=['chrome','firefox'],default='chrome');target=parser.parse_args().browser
root=Path(__file__).resolve().parents[1];assets=root/'tests'/'assets';test_extension=assets/('studio-'+target)
shutil.copytree(root/'build'/target,test_extension,dirs_exist_ok=True)
config=json.loads((test_extension/'commerce-config.json').read_text());config['edition']='licensed';config['publicKey']=None
config['lemon']={'provider':'lemonsqueezy','testMode':True,'storeId':7,'products':{p:{'productId':8,'variantId':i,'checkoutURL':f'https://rightsave.lemonsqueezy.com/checkout/buy/00000000-0000-0000-0000-0000000000{i}'} for p,i in [('pro',9),('studio',10)]}}
(test_extension/'commerce-config.json').write_text(json.dumps(config))
shutil.copyfile(root/'tests'/'payment-fixture.js',test_extension/'payment-fixture.js')
manifest=json.loads((test_extension/'manifest.json').read_text())
if target=='firefox':
    manifest['background']['scripts'].insert(1,'payment-fixture.js')
    manifest['browser_specific_settings']['gecko']['data_collection_permissions']={'required':['authenticationInfo']}
else:
    p=test_extension/'worker.js';p.write_text(p.read_text().replace('"shared.js",','"payment-fixture.js", "shared.js",'))
(test_extension/'manifest.json').write_text(json.dumps(manifest))
downloads=root/'tests'/'downloads'/('studio-'+target+'-'+str(time.time_ns()));downloads.mkdir(parents=True)
class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*_):pass
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
result_path=root/'tests'/('results-studio-'+target+'.json');result_path.write_text(json.dumps({'status':'running'}))
def ext(script,*args):return driver.execute_async_script('const done=arguments[arguments.length-1];(async()=>{'+script+'})().then(done,e=>done({error:e.message}));',*args)
def check(name,condition):assert condition,name;checks.append(name);print('PASS',name,flush=True)
try:
    if target=='firefox':
        archive=assets/'studio-test.xpi'
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
        ws.send(json.dumps({'id':1,'method':'Runtime.evaluate','params':{'expression':'globalThis.__saveCalls=[];const nativeDownload=chrome.downloads.download.bind(chrome.downloads);chrome.downloads.download=options=>{__saveCalls.push(options);return new Promise((resolve,reject)=>nativeDownload({...options,saveAs:false},id=>chrome.runtime.lastError?reject(new Error(chrome.runtime.lastError.message)):resolve(id)));};true','returnByValue':True}}))
        while json.loads(ws.recv()).get('id')!=1:pass
    driver.get(extension+'support.html');ui=driver.current_window_handle
    wait.until(lambda d:ext('return (await browser.tabs.query({})).some(t=>t.url===browser.runtime.getURL("welcome.html"));'))
    ext('await browser.tabs.remove((await browser.tabs.query({})).filter(t=>t.url===browser.runtime.getURL("welcome.html")).map(t=>t.id));return true;')
    if target=='chrome':driver.execute_cdp_cmd('Browser.setDownloadBehavior',{'behavior':'allow','downloadPath':str(downloads),'eventsEnabled':True})
    wait.until(lambda d:driver.find_element(By.ID,'activate').is_enabled())
    check('Configured build labels hosted Pro and Studio checkout as tests','Test' in driver.find_element(By.ID,'checkout').text and 'Test' in driver.find_element(By.ID,'checkout-studio').text)
    driver.find_element(By.ID,'license').send_keys('studio-test-key');driver.find_element(By.ID,'activate').click();wait.until(lambda d:'Studio is active' in driver.find_element(By.ID,'status').text)
    check('Receipt key activates Studio through the real background RPC',driver.find_element(By.ID,'license').get_attribute('value')=='')
    check('Customer email is discarded rather than stored','never-store' not in json.dumps(ext('return await browser.storage.local.get();')))
    ext('return await browser.runtime.sendMessage({type:"commerce",action:"activate",key:"studio-test-key"});')
    calls=ext('return (await browser.storage.local.get("mockCalls")).mockCalls;')
    check('Repeated activation does not consume another provider activation',len([c for c in calls if c['action']=='activate'])==1)
    driver.switch_to.new_window('tab');driver.get(base);driver.switch_to.window(ui)
    tab=next(t for t in ext('return await browser.tabs.query({});') if t.get('url','').rstrip('/')==base)
    before=set(driver.window_handles);ext('return await browser.runtime.sendMessage({type:"browse",tabId:arguments[0]});',tab['id']);wait.until(lambda d:bool(set(d.window_handles)-before));driver.switch_to.window(next(iter(set(driver.window_handles)-before)))
    wait.until(lambda d:len(d.find_elements(By.CSS_SELECTOR,'.media-card'))==3)
    check('Studio enables collection and source-record controls',driver.find_element(By.ID,'plan-label').text=='Studio' and driver.find_element(By.ID,'source-records').is_enabled())
    driver.find_element(By.CSS_SELECTOR,'#library-tools > summary').click();driver.find_element(By.ID,'select-visible').click();driver.find_element(By.ID,'source-records').click();driver.find_element(By.ID,'save-zip').click()
    wait.until(lambda d:'3 files packaged' in driver.find_element(By.ID,'archive-status').text)
    wait.until(lambda d:ext('return (await browser.downloads.search({orderBy:["-startTime"],limit:1}))[0]?.state;')=='complete')
    saved=Path(ext('return (await browser.downloads.search({orderBy:["-startTime"],limit:1}))[0].filename;'))
    with zipfile.ZipFile(saved) as z:
        record=json.loads(z.read('_rightsave/sources.json'))
        check('Native ZIP contains three exact photos and both source records',z.testzip() is None and len(z.namelist())==5 and z.read('coast-photo.png')==(root/'docs/demo/coast-photo.png').read_bytes() and '_rightsave/sources.csv' in z.namelist())
        check('Source records match archive filenames and the source page',len(record['files'])==3 and all(row['filename'] in z.namelist() and row['page'].startswith(base) for row in record['files']))
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
    driver.switch_to.window(ui);driver.get(extension+'support.html');wait.until(lambda d:driver.find_element(By.ID,'remove-license').is_enabled());driver.find_element(By.ID,'remove-license').click();wait.until(lambda d:'Browser deactivated' in driver.find_element(By.ID,'status').text)
    check('Deactivation releases the provider instance before returning to Free',not ext('return !!(await browser.storage.local.get("purchaseLicense")).purchaseLicense;') and ext('return (await browser.storage.local.get("mockCalls")).mockCalls.at(-1).action;')=='deactivate')
    driver.find_element(By.ID,'license').send_keys('studio-test-key');driver.find_element(By.ID,'activate').click();wait.until(lambda d:'Studio is active' in driver.find_element(By.ID,'status').text)
    ext('await browser.storage.local.set({mockMode:"disabled"});return true;');driver.find_element(By.ID,'refresh-license').click();wait.until(lambda d:not ext('return !!(await browser.storage.local.get("purchaseLicense")).purchaseLicense;'))
    check('Disabled provider license removes paid access on its next check',ext('return (await browser.runtime.sendMessage({type:"commerce",action:"status"})).plan;')=='free')
    result_path.write_text(json.dumps({'status':'passed','checks':len(checks),'passed':checks,'browser':driver.capabilities['browserVersion'],'provider':'deterministic fixture, no real checkout'},indent=2))
finally:driver.quit();server.shutdown()
