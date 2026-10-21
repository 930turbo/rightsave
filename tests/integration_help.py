"""Exercise help, practice Save As, selection and cleanup in disposable profiles."""
from pathlib import Path
import argparse,functools,http.server,json,os,sys,threading,time,urllib.request,zipfile
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait
sys.stdout.reconfigure(encoding='utf-8')
parser=argparse.ArgumentParser();parser.add_argument('--browser',choices=['chrome','firefox'],default='firefox');target=parser.parse_args().browser
root=Path(__file__).resolve().parents[1];assets=root/'tests/assets/help';assets.mkdir(parents=True,exist_ok=True)
downloads=root/'tests/downloads'/('help-'+target+'-'+str(time.time_ns()));downloads.mkdir(parents=True)
class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*_):pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(root/'docs/demo')));threading.Thread(target=server.serve_forever,daemon=True).start();base=f'http://127.0.0.1:{server.server_port}'
if target=='firefox':
    from selenium.webdriver.firefox.options import Options
    from selenium.webdriver.firefox.service import Service
    options=Options();options.add_argument('-headless');options.binary_location=os.environ.get('FIREFOX_BINARY',r'C:\Program Files\Mozilla Firefox\firefox.exe');driver=webdriver.Firefox(options=options,service=Service(service_args=['--allow-system-access']))
else:
    from selenium.webdriver.chrome.options import Options
    options=Options();options.add_argument('--headless=new');options.add_argument('--remote-allow-origins=*')
    if os.environ.get('CHROMIUM_BINARY'):options.binary_location=str(Path(os.environ['CHROMIUM_BINARY']).resolve())
    options.add_argument('--load-extension='+str(root/'build/chrome'));options.add_argument('--disable-extensions-except='+str(root/'build/chrome'));options.add_experimental_option('enableExtensionTargets',True);driver=webdriver.Chrome(options=options)
wait=WebDriverWait(driver,20);driver.set_window_size(1440,1100);checks=[]
def ext(script,*args):return driver.execute_async_script('const done=arguments[arguments.length-1];(async()=>{'+script+'})().then(done,e=>done({error:e.message}));',*args)
def check(name,condition):assert condition,name;checks.append(name);print('PASS',name,flush=True)
result_path=root/'tests'/('results-help-'+target+'.json');result_path.write_text(json.dumps({'status':'running'}))
try:
    if target=='firefox':
        archive=assets/'help.xpi'
        with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
            for p in (root/'build/firefox').rglob('*'):
                if p.is_file():z.write(p,p.relative_to(root/'build/firefox').as_posix())
        addon=driver.install_addon(str(archive),temporary=True);driver.set_context('chrome');uuid=json.loads(driver.execute_script("return Services.prefs.getStringPref('extensions.webextensions.uuids')"))[addon];driver.execute_script((root/'tests/file-picker.js').read_text(encoding='utf-8'),str(downloads));driver.set_context('content');extension=f'moz-extension://{uuid}/'
    else:
        def workers():return [t for t in driver.execute_cdp_cmd('Target.getTargets',{})['targetInfos'] if t['type']=='service_worker' and t['url'].endswith('/worker.js')]
        wait.until(lambda d:workers());extension=workers()[0]['url'].rsplit('/',1)[0]+'/'
    driver.get(extension+'support.html');ui=driver.current_window_handle
    wait.until(lambda d:ext('return (await browser.tabs.query({})).some(t=>t.url===browser.runtime.getURL("welcome.html"));'))
    ext('await browser.tabs.remove((await browser.tabs.query({})).filter(t=>t.url===browser.runtime.getURL("welcome.html")).map(t=>t.id));return true;')
    wait.until(lambda d:driver.execute_script('return document.documentElement.dataset.theme==="dark"'))
    check('Help loads locally without an account or checkout',not driver.find_elements(By.ID,'license-tools') and len(driver.find_elements(By.CSS_SELECTOR,'[data-help]'))==7)
    for guide in ['first','collections','video','convert','workflows']:
        driver.find_element(By.CSS_SELECTOR,f'[data-guide="{guide}"]').click();wait.until(lambda d:driver.find_element(By.CSS_SELECTOR,'.guide-dialog').get_attribute('open'))
        check(guide+' guide starts with an accessible title and first step',driver.find_element(By.ID,'guide-title').text!='' and 'Step 1 of 4' in driver.find_element(By.CSS_SELECTOR,'.guide-progress').text)
        for _ in range(3):driver.find_element(By.CSS_SELECTOR,'.guide-dialog .viewer-bottom .primary').click()
        check(guide+' guide reaches its final actionable step',driver.find_element(By.CSS_SELECTOR,'.guide-dialog .viewer-bottom .primary').text=='Done')
        driver.find_element(By.CSS_SELECTOR,'.guide-dialog .viewer-bottom .primary').click()
    search=driver.find_element(By.ID,'help-search');search.send_keys('zz-no-guide');check('Help search gives an actionable empty state',driver.find_element(By.ID,'help-empty').is_displayed());search.clear();search.send_keys('ZIP');check('Help search narrows guides',1<=len([e for e in driver.find_elements(By.CSS_SELECTOR,'[data-help]') if e.is_displayed()])<7);search.clear();driver.execute_script('document.getElementById("help-search").dispatchEvent(new Event("input"))')
    ext('await browser.storage.local.set({privateTestAddress:"https://private.test/?token=do-not-share",purchaseLicense:{key:"do-not-share"},disabledSites:["private.test"]});return true;')
    driver.find_element(By.ID,'diagnostics').click();diagnostic=driver.find_element(By.ID,'diagnostic-output').get_attribute('value')
    check('Diagnostics include versions and settings but omit private local fields','RightSave 5.0.0' in diagnostic and 'Browser:' in diagnostic and 'private.test' not in diagnostic and 'do-not-share' not in diagnostic)
    ext('await browser.storage.local.remove(["privateTestAddress","purchaseLicense"]);await browser.storage.local.set({disabledSites:[]});return true;')
    # Replace only the test page API wrapper, keeping original options for assertion.
    driver.execute_script('window.__practice=[];const original=browser.downloads.download.bind(browser.downloads);browser.downloads.download=options=>{__practice.push({saveAs:options.saveAs,filename:options.filename});return original({...options,saveAs:false});};' if target=='chrome' else 'window.__practice=[];const original=browser.downloads.download.bind(browser.downloads);browser.downloads.download=options=>{__practice.push({saveAs:options.saveAs,filename:options.filename});return original(options);};')
    if target=='chrome':driver.execute_cdp_cmd('Browser.setDownloadBehavior',{'behavior':'allow','downloadPath':str(downloads),'eventsEnabled':True})
    driver.find_element(By.ID,'practice-save').click();wait.until(lambda d:'sent to Downloads' in driver.find_element(By.ID,'practice-status').text)
    wait.until(lambda d:ext('return (await browser.downloads.search({orderBy:["-startTime"],limit:1}))[0]?.state;')=='complete')
    saved=Path(ext('return (await browser.downloads.search({orderBy:["-startTime"],limit:1}))[0].filename;'))
    check('Practice save requests native Save As and writes the bundled drawing',driver.execute_script('return __practice[0].saveAs') and saved.read_bytes()==(root/'extension/practice.svg').read_bytes())
    driver.switch_to.new_window('tab');driver.get(base);source=driver.current_window_handle;driver.switch_to.window(ui)
    tab=next(t for t in ext('return await browser.tabs.query({});') if t.get('url','').rstrip('/')==base)
    before=set(driver.window_handles);ext('return await browser.runtime.sendMessage({type:"browse",tabId:arguments[0]});',tab['id']);wait.until(lambda d:bool(set(d.window_handles)-before));library=next(iter(set(driver.window_handles)-before));driver.switch_to.window(library);wait.until(lambda d:len(driver.find_elements(By.CSS_SELECTOR,'.media-card'))==3)
    driver.find_element(By.CSS_SELECTOR,'.tile-select input').click();check('Selecting a file reveals the collection dock',driver.find_element(By.ID,'selection-dock').is_displayed() and driver.find_element(By.ID,'dock-count').text=='1 selected')
    driver.find_element(By.ID,'dock-tools').click();driver.find_element(By.ID,'invert-selection').click();check('Invert selection changes one of three files into the other two','2' in driver.find_element(By.ID,'dock-count').text)
    driver.find_element(By.ID,'clear-selection').click();check('Clear removes the selection and hides its dock',not driver.find_element(By.ID,'selection-dock').is_displayed())
    driver.find_element(By.ID,'dismiss-tip').click();check('A dismissed library tip stays dismissed on this browser',ext('return (await browser.storage.local.get("libraryTipDismissed")).libraryTipDismissed;') is True)
    # Delay the first save to exercise Stop after this file without native-dialog races.
    driver.execute_script('window.__batch=[];let release;const original=browser.runtime.sendMessage.bind(browser.runtime);browser.runtime.sendMessage=message=>{if(message.type!=="save")return original(message);__batch.push(message);return new Promise(resolve=>release=()=>resolve({id:99}));};window.__release=()=>release();')
    driver.find_element(By.ID,'select-visible').click();driver.find_element(By.ID,'save-selected').click();wait.until(lambda d:driver.find_element(By.ID,'cancel-batch').is_displayed());driver.find_element(By.ID,'cancel-batch').click();driver.execute_script('__release()');wait.until(lambda d:'Queue stopped' in driver.find_element(By.ID,'notice').text)
    check('Stop after this file prevents subsequent Save As requests',driver.execute_script('return __batch.length')==1 and '1 file sent' in driver.find_element(By.ID,'notice').text)
    # Read session state from the existing help tab after closing the actual library.
    driver.close();driver.switch_to.window(ui);wait.until(lambda d:not ext('return Object.values(await browser.storage.session.get(null)).some(v=>v?.tabId===arguments[0]&&Array.isArray(v.items));',tab['id']))
    check('Closing the library removes its stored source list',not ext('return Object.keys(await browser.storage.session.get(null)).some(k=>k.startsWith("picker:"));'))
    ext('await browser.storage.session.set({"picker:test":{items:[]},"network:1":[{url:"private"}]});return true;');driver.get(extension+'options.html');wait.until(lambda d:driver.find_element(By.ID,'clear-lists').is_displayed());driver.find_element(By.ID,'clear-lists').click();wait.until(lambda d:'Temporary lists cleared' in driver.find_element(By.ID,'status').text)
    check('Clear lists discards scans while retaining preferences',ext('const data=await browser.storage.session.get(null);return !Object.keys(data).some(k=>/^(picker:|network:)/.test(k));') and ext('return (await browser.storage.local.get("libraryTipDismissed")).libraryTipDismissed;') is True)
    result_path.write_text(json.dumps({'status':'passed','checks':len(checks),'passed':checks,'browser':driver.capabilities['browserVersion']},indent=2))
finally:driver.quit();server.shutdown()
