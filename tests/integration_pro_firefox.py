"""Licensed Firefox ZIP workflow in a disposable profile with an ephemeral test key."""
from pathlib import Path
import functools,http.server,json,os,shutil,subprocess,threading,time,zipfile
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.firefox.service import Service
from selenium.webdriver.support.ui import WebDriverWait
root=Path(__file__).resolve().parents[1];assets=root/'tests'/'assets'
copy=assets/'pro-firefox';shutil.copytree(root/'build'/'firefox',copy,dirs_exist_ok=True)
license=json.loads(subprocess.check_output(['node',str(root/'tests'/'license-fixture.mjs')],text=True))
config=json.loads((copy/'commerce-config.json').read_text());config.update(publicKey=license['publicKey'],edition='licensed');(copy/'commerce-config.json').write_text(json.dumps(config))
archive=assets/'pro-firefox.xpi'
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
    for p in copy.rglob('*'):
        if p.is_file():z.write(p,p.relative_to(copy).as_posix())
downloads=assets/('pro-firefox-downloads-'+str(int(time.time())));downloads.mkdir()
class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*_):pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(assets)));threading.Thread(target=server.serve_forever,daemon=True).start();base=f'http://127.0.0.1:{server.server_port}'
options=Options();options.add_argument('-headless');options.binary_location=os.environ.get('FIREFOX_BINARY',r'C:\Program Files\Mozilla Firefox\firefox.exe')
driver=webdriver.Firefox(options=options,service=Service(service_args=['--allow-system-access']));wait=WebDriverWait(driver,15);driver.set_window_size(1440,1100);checks=[]
result_path=root/'tests'/'results-pro-firefox.json';result_path.write_text(json.dumps({'status':'running'}))
def ext(script,*args):return driver.execute_async_script('const done=arguments[arguments.length-1];(async()=>{'+script+'})().then(done,e=>done({error:e.message}));',*args)
def check(name,condition):assert condition,name;checks.append(name);print('PASS',name,flush=True)
try:
    addon=driver.install_addon(str(archive),temporary=True);driver.set_context('chrome');uuid=json.loads(driver.execute_script("return Services.prefs.getStringPref('extensions.webextensions.uuids')"))[addon];driver.execute_script((root/'tests'/'file-picker.js').read_text(),str(downloads));driver.set_context('content');extension=f'moz-extension://{uuid}/'
    driver.get(extension+'options.html');ui=driver.current_window_handle
    wait.until(lambda d:ext('return (await browser.tabs.query({})).some(t=>t.url===browser.runtime.getURL("welcome.html"));'))
    ext('await browser.tabs.remove((await browser.tabs.query({})).filter(t=>t.url===browser.runtime.getURL("welcome.html")).map(t=>t.id));await browser.storage.local.set({license:arguments[0],quickSave:false});return true;',license['token'])
    driver.switch_to.new_window('tab');driver.get(base);driver.switch_to.window(ui)
    tab=next(t for t in ext('return await browser.tabs.query({});') if t.get('url','').rstrip('/')==base)
    handles=set(driver.window_handles);ext('return await browser.runtime.sendMessage({type:"browse",tabId:arguments[0]});',tab['id'])
    wait.until(lambda d:bool(set(d.window_handles)-handles));driver.switch_to.window(next(iter(set(driver.window_handles)-handles)));wait.until(lambda d:len(d.find_elements(By.CSS_SELECTOR,'.media-card'))>=8)
    check('Signed test entitlement activates Firefox licensed UI',driver.find_element(By.ID,'plan-label').text=='Plus')
    driver.find_element(By.CSS_SELECTOR,'#library-tools > summary').click()
    for label in ['Under an overlay','Canvas']:
        card=next(c for c in driver.find_elements(By.CSS_SELECTOR,'.media-card') if label in c.text);card.find_element(By.CSS_SELECTOR,'.tile-select input').click()
    driver.find_element(By.ID,'save-zip').click();wait.until(lambda d:'2 files packaged' in d.find_element(By.ID,'archive-status').text)
    wait.until(lambda d:ext('return (await browser.downloads.search({orderBy:["-startTime"],limit:1}))[0]?.state;')=='complete')
    saved=Path(ext('return (await browser.downloads.search({orderBy:["-startTime"],limit:1}))[0].filename;'))
    with zipfile.ZipFile(saved) as z:
        check('Firefox native Save As receives one valid ZIP containing original image and canvas',z.testzip() is None and len(z.namelist())==2 and z.read('image.png')==(assets/'image.png').read_bytes() and z.read('rightsave-image.png').startswith(b'\x89PNG'))
    ext('await browser.storage.local.remove("license");return true;')
    denied=ext('return await browser.runtime.sendMessage({type:"archive-source",tabId:arguments[0],item:{url:"https://example.org/a.png",kind:"image"}});',tab['id'])
    check('Firefox rejects archive access after license removal','Pro feature' in denied.get('error',''))
    result_path.write_text(json.dumps({'status':'passed','checks':len(checks),'passed':checks,'browser':driver.capabilities['browserVersion']},indent=2))
finally:driver.quit();server.shutdown()
