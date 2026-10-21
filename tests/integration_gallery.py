"""Free gallery controls in real browsers, without altering the user's clipboard."""
from pathlib import Path
import argparse,functools,http.server,json,os,sys,threading,time,zipfile
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait,Select
from PIL import Image
sys.stdout.reconfigure(encoding='utf-8')
parser=argparse.ArgumentParser();parser.add_argument('--browser',choices=['chrome','firefox'],default='chrome');target=parser.parse_args().browser
root=Path(__file__).resolve().parents[1];assets=root/'tests/assets/gallery';assets.mkdir(parents=True,exist_ok=True)
for name,size,color in [('landscape',(400,200),'#376083'),('portrait',(200,400),'#836442'),('square',(300,300),'#527665')]:Image.new('RGB',size,color).save(assets/(name+'.png'))
(assets/'index.html').write_text('<!doctype html><html><head><title>Gallery check</title></head><body><img src="landscape.png" alt="Landscape"><img src="portrait.png" alt="Portrait"><img src="square.png" alt="Square"><img data-src="slow.png" width="400" height="200" alt="Slow preview"></body></html>')
started=threading.Event()
class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*_):pass
    def do_GET(self):
        if self.path=='/slow.png':
            payload=(assets/'landscape.png').read_bytes();self.send_response(200);self.send_header('Content-Type','image/png');self.send_header('Content-Length',str(len(payload)));self.end_headers();started.set();time.sleep(3)
            try:self.wfile.write(payload)
            except (BrokenPipeError,ConnectionResetError,ConnectionAbortedError):pass
            return
        return super().do_GET()
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(assets)));threading.Thread(target=server.serve_forever,daemon=True).start();base=f'http://127.0.0.1:{server.server_port}'
if target=='firefox':
    from selenium.webdriver.firefox.options import Options
    from selenium.webdriver.firefox.service import Service
    options=Options();options.add_argument('-headless');options.binary_location=os.environ.get('FIREFOX_BINARY',r'C:\Program Files\Mozilla Firefox\firefox.exe');driver=webdriver.Firefox(options=options,service=Service(service_args=['--allow-system-access']))
else:
    from selenium.webdriver.chrome.options import Options
    options=Options();options.add_argument('--headless=new')
    if os.environ.get('CHROMIUM_BINARY'):options.binary_location=str(Path(os.environ['CHROMIUM_BINARY']).resolve())
    options.add_argument('--load-extension='+str(root/'build/chrome'));options.add_argument('--disable-extensions-except='+str(root/'build/chrome'));options.add_experimental_option('enableExtensionTargets',True);driver=webdriver.Chrome(options=options)
driver.set_window_size(1440,1100);wait=WebDriverWait(driver,15);checks=[]
result_path=root/'tests'/('results-gallery-'+target+'.json');result_path.write_text(json.dumps({'status':'running'}))
def ext(script,*args):return driver.execute_async_script('const done=arguments[arguments.length-1];(async()=>{'+script+'})().then(done,e=>done({error:e.message}));',*args)
def check(name,condition):assert condition,name;checks.append(name);print('PASS',name,flush=True)
def count():return len(driver.find_elements(By.CSS_SELECTOR,'.media-card'))
try:
    if target=='firefox':
        archive=assets/'gallery.xpi'
        with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
            for p in (root/'build/firefox').rglob('*'):
                if p.is_file():z.write(p,p.relative_to(root/'build/firefox').as_posix())
        addon=driver.install_addon(str(archive),temporary=True);driver.set_context('chrome');uuid=json.loads(driver.execute_script("return Services.prefs.getStringPref('extensions.webextensions.uuids')"))[addon];driver.set_context('content');extension=f'moz-extension://{uuid}/'
    else:
        def workers():return [t for t in driver.execute_cdp_cmd('Target.getTargets',{})['targetInfos'] if t['type']=='service_worker' and t['url'].endswith('/worker.js')]
        wait.until(lambda d:workers());extension=workers()[0]['url'].rsplit('/',1)[0]+'/'
    driver.get(extension+'support.html');ui=driver.current_window_handle
    wait.until(lambda d:'RightSave Free' in driver.find_element(By.ID,'status').text)
    check('Free help contains no pricing or upgrade wall',not driver.find_elements(By.ID,'paid-tools') and not driver.find_elements(By.ID,'license-tools') and '$' not in driver.find_element(By.TAG_NAME,'body').text)
    wait.until(lambda d:ext('return (await browser.tabs.query({})).some(t=>t.url===browser.runtime.getURL("welcome.html"));'))
    ext('await browser.tabs.remove((await browser.tabs.query({})).filter(t=>t.url===browser.runtime.getURL("welcome.html")).map(t=>t.id));return true;')
    driver.switch_to.new_window('tab');driver.get(base);driver.switch_to.window(ui)
    tab=next(t for t in ext('return await browser.tabs.query({});') if t.get('url','').rstrip('/')==base)
    before=set(driver.window_handles);ext('return await browser.runtime.sendMessage({type:"browse",tabId:arguments[0]});',tab['id']);wait.until(lambda d:bool(set(d.window_handles)-before));driver.switch_to.window(next(iter(set(driver.window_handles)-before)));wait.until(lambda d:count()==4)
    driver.find_element(By.CSS_SELECTOR,'#library-tools > summary').click()
    check('Basic format, shape and width controls are available without a license',driver.find_element(By.ID,'format').is_enabled() and driver.find_element(By.ID,'orientation').is_enabled() and driver.find_element(By.ID,'min-width').is_enabled() and driver.find_element(By.ID,'collection-tools').is_displayed())
    Select(driver.find_element(By.ID,'orientation')).select_by_value('portrait');check('Portrait filter finds the actual portrait image',count()==1 and 'Portrait' in driver.find_element(By.CSS_SELECTOR,'.media-card').text)
    Select(driver.find_element(By.ID,'orientation')).select_by_value('square');check('Square filter uses media dimensions',count()==1 and 'Square' in driver.find_element(By.CSS_SELECTOR,'.media-card').text)
    driver.find_element(By.ID,'clear-filters').click();Select(driver.find_element(By.ID,'format')).select_by_value('jpg');check('Format filter does not pretend PNG files are JPEG',count()==0)
    driver.find_element(By.ID,'clear-filters').click();driver.find_element(By.ID,'min-width').clear();driver.find_element(By.ID,'min-width').send_keys('350');check('Minimum width filtering works in Free',count()==1 and 'Landscape' in driver.find_element(By.CSS_SELECTOR,'.media-card').text)
    driver.find_element(By.ID,'clear-filters').click();check('Reset restores the complete gallery',count()==4)
    driver.execute_script('navigator.clipboard.writeText=async value=>{window.__copied=value};')
    card=next(c for c in driver.find_elements(By.CSS_SELECTOR,'.media-card') if c.find_element(By.TAG_NAME,'h2').text=='Landscape');card.find_element(By.CSS_SELECTOR,'.copy-link').click();wait.until(lambda d:driver.execute_script('return window.__copied'))
    check('Copy link passes the exact selected URL to the clipboard API',driver.execute_script('return window.__copied')==base+'/landscape.png')
    driver.find_element(By.ID,'load-all').click();wait.until(lambda d:started.is_set());driver.find_element(By.ID,'cancel-previews').click();wait.until(lambda d:driver.find_element(By.ID,'load-all').is_enabled())
    check('Stop loading aborts an outstanding preview and restores controls','Loading stopped' in driver.find_element(By.ID,'notice').text and not driver.find_element(By.ID,'cancel-previews').is_displayed())
    driver.find_element(By.ID,'load-all').click();wait.until(lambda d:driver.find_element(By.ID,'load-all').is_enabled())
    check('Stopped previews can be loaded again without starting a download',len(driver.find_elements(By.CSS_SELECTOR,'.preview img'))==4 and ext('return (await browser.downloads.search({})).length;')==0)
    driver.find_element(By.CSS_SELECTOR,'.preview img').click();wait.until(lambda d:driver.find_element(By.ID,'zoom-image').is_displayed())
    first=driver.find_element(By.ID,'zoom-title').text;driver.find_element(By.ID,'zoom-next').click();wait.until(lambda d:driver.find_element(By.ID,'zoom-title').text!=first)
    check('Expanded viewer moves to the next actual media item','2 of 4' in driver.find_element(By.ID,'zoom-position').text)
    driver.find_element(By.ID,'zoom-next').send_keys(Keys.ARROW_LEFT);wait.until(lambda d:driver.find_element(By.ID,'zoom-title').text==first)
    check('Arrow keys navigate the expanded viewer','1 of 4' in driver.find_element(By.ID,'zoom-position').text)
    driver.execute_script('const native=browser.runtime.sendMessage.bind(browser.runtime);browser.runtime.sendMessage=message=>message.type==="save"?(window.__viewerSave=message,Promise.resolve({id:null})):native(message);')
    driver.find_element(By.ID,'zoom-save').click();wait.until(lambda d:'Save canceled' in driver.find_element(By.ID,'zoom-status').text)
    check('Viewer Save original requests the currently displayed source',driver.execute_script('return window.__viewerSave.item.url')==base+'/landscape.png')
    check('Still-image conversion is available in the free viewer',driver.find_element(By.ID,'convert-tools').is_displayed())
    driver.find_element(By.ID,'close-zoom').click()
    driver.find_element(By.TAG_NAME,'body').send_keys('/');check('Slash focuses the gallery search',driver.execute_script('return document.activeElement.id')=='search')
    result_path.write_text(json.dumps({'status':'passed','checks':len(checks),'passed':checks,'browser':driver.capabilities['browserVersion']},indent=2))
finally:driver.quit();server.shutdown()
