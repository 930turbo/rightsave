"""Capture real extension pages and check responsive layout in an isolated profile."""
from pathlib import Path
import base64,functools,http.server,json,os,threading
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
root=Path(__file__).resolve().parents[1]
class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*_):pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(root/'docs'/'demo')))
threading.Thread(target=server.serve_forever,daemon=True).start()
base=f'http://127.0.0.1:{server.server_port}'
options=Options();options.add_argument('--headless=new')
if os.environ.get('CHROMIUM_BINARY'):options.binary_location=str(Path(os.environ['CHROMIUM_BINARY']).resolve())
options.add_argument('--load-extension='+str(root/'build'/'chrome'))
options.add_argument('--disable-extensions-except='+str(root/'build'/'chrome'))
options.add_experimental_option('enableExtensionTargets',True)
driver=webdriver.Chrome(options=options)
(root/'tests'/'results-ui.json').write_text(json.dumps({'status':'running'}))
checks=[]
def check(name,condition):
    assert condition,name
    checks.append(name)
def settled():
    WebDriverWait(driver,10).until(lambda d:d.execute_script('return !!document.documentElement.dataset.theme'))
    driver.execute_async_script('const done=arguments[arguments.length-1];requestAnimationFrame(()=>requestAnimationFrame(()=>done()));')
def no_overflow(label):
    check(label,driver.execute_script('return document.documentElement.scrollWidth<=innerWidth'))
def viewport(width,height=1000):
    driver.execute_cdp_cmd('Emulation.setDeviceMetricsOverride',{'width':width,'height':height,'deviceScaleFactor':1,'mobile':False})
    driver.execute_cdp_cmd('Emulation.setEmulatedMedia',{'features':[{'name':'prefers-reduced-motion','value':'reduce'}]})
    check(f'Viewport is {width}px wide',driver.execute_script('return innerWidth')==width)
def capture(path):
    result=driver.execute_cdp_cmd('Page.captureScreenshot',{'format':'png','captureBeyondViewport':True})
    path.write_bytes(base64.b64decode(result['data']))
try:
    driver.set_window_size(1440,1150)
    def workers():return [t for t in driver.execute_cdp_cmd('Target.getTargets',{})['targetInfos'] if t['type']=='service_worker' and t['url'].endswith('/worker.js')]
    WebDriverWait(driver,15).until(lambda d:workers())
    extension=workers()[0]['url'].rsplit('/',1)[0]+'/'
    driver.get(extension+'options.html')
    WebDriverWait(driver,15).until(lambda d:d.execute_async_script('const done=arguments[arguments.length-1];browser.tabs.query({}).then(t=>done(t.some(t=>t.url===browser.runtime.getURL("welcome.html"))));'))
    driver.execute_async_script('const done=arguments[arguments.length-1];browser.tabs.query({}).then(t=>browser.tabs.remove(t.filter(t=>t.url===browser.runtime.getURL("welcome.html")).map(t=>t.id))).then(done);')
    driver.get(base);driver.switch_to.new_window('tab');driver.get(extension+'options.html')
    result=driver.execute_async_script('const done=arguments[arguments.length-1];(async()=>{const t=(await browser.tabs.query({})).find(t=>t.url.startsWith(arguments[0]));return await browser.runtime.sendMessage({type:"browse",tabId:t.id})})().then(done);',base)
    assert result.get('ok')
    WebDriverWait(driver,15).until(lambda d:len(d.window_handles)==3);driver.switch_to.window(driver.window_handles[-1])
    viewport(1440,1150)
    WebDriverWait(driver,15).until(lambda d:len(d.find_elements(By.CSS_SELECTOR,'.media-card'))==3)
    driver.find_element(By.ID,'load-all').click();WebDriverWait(driver,15).until(lambda d:d.find_element(By.ID,'load-all').is_enabled())
    assert len(driver.find_elements(By.CSS_SELECTOR,'.preview img'))==3
    settled()
    library=driver.current_url
    check('Dark is the default appearance',driver.execute_script('return document.documentElement.dataset.theme==="dark"&&getComputedStyle(document.documentElement).colorScheme==="dark"'))
    check('Collection tools start collapsed',not driver.find_element(By.ID,'library-tools').get_attribute('open'))
    driver.find_element(By.ID,'search').send_keys('Moonrise')
    check('Search is usable in the minimal toolbar',len(driver.find_elements(By.CSS_SELECTOR,'.media-card'))==1)
    driver.find_element(By.ID,'search').clear()
    driver.find_element(By.ID,'search').send_keys('')
    driver.execute_script('document.getElementById("search").dispatchEvent(new Event("input"))')
    check('Keyboard focus has a visible outline',driver.execute_script('return getComputedStyle(document.activeElement).outlineStyle!=="none"'))
    check('Reduced-motion preference disables transitions',driver.execute_script('return getComputedStyle(document.getElementById("search")).transitionDuration==="0s"'))
    driver.execute_script('document.activeElement.blur()')
    no_overflow('Desktop library has no horizontal overflow')
    capture(root/'docs'/'library.png')
    store_assets=root/'store'/'assets';store_assets.mkdir(parents=True,exist_ok=True)
    viewport(1280,800)
    def store_capture(name):
        result=driver.execute_cdp_cmd('Page.captureScreenshot',{'format':'png','captureBeyondViewport':False})
        (store_assets/name).write_bytes(base64.b64decode(result['data']))
    store_capture('library-1280x800.png')
    driver.execute_script('scrollTo(0,document.getElementById("media").offsetTop-65)')
    store_capture('saving-1280x800.png')
    viewport(1440,1150);driver.execute_script('scrollTo(0,0)')
    driver.find_element(By.CSS_SELECTOR,'#library-tools > summary').click()
    check('Free view exposes filters without upgrade advertising',driver.find_element(By.ID,'min-width').is_enabled() and driver.find_element(By.ID,'format').is_displayed() and not driver.find_element(By.ID,'collection-tools').is_displayed())
    for width in [768,390,320]:
        viewport(width)
        no_overflow(f'Library tools fit a {width}px window')
    driver.find_element(By.CSS_SELECTOR,'#library-tools > summary').click()
    viewport(390)
    capture(root/'tests'/'library-mobile.png')
    viewport(1440,1150)
    driver.find_element(By.CSS_SELECTOR,'.preview img').click()
    WebDriverWait(driver,10).until(lambda d:d.find_element(By.ID,'zoom-image').is_displayed())
    check('Expanded preview has original-saving and navigation controls',driver.find_element(By.ID,'zoom-save').is_displayed() and driver.find_element(By.ID,'zoom-next').is_displayed())
    capture(root/'docs'/'viewer.png')
    viewport(320)
    no_overflow('Expanded preview fits a 320px window')
    capture(root/'tests'/'viewer-mobile.png')
    driver.find_element(By.ID,'close-zoom').click()
    viewport(1440,1150)
    for page in ['options','support','welcome']:
        driver.get(extension+page+'.html');settled()
        no_overflow(f'Desktop {page} has no horizontal overflow')
        capture(root/'docs'/('settings.png' if page=='options' else page+'.png'))
        viewport(320)
        no_overflow(f'{page.title()} fits a 320px window')
        viewport(1440,1150)
    driver.get(extension+'options.html');settled()
    driver.execute_async_script('const done=arguments[arguments.length-1];browser.storage.local.set({theme:"light"}).then(done);')
    driver.get(library);settled()
    check('Explicit light appearance is preserved',driver.execute_script('return getComputedStyle(document.documentElement).colorScheme==="light"'))
    capture(root/'tests'/'library-light.png')
    driver.execute_async_script('const done=arguments[arguments.length-1];browser.storage.local.set({theme:"dark"}).then(done);')
    driver.get(extension+'popup.html');settled()
    check('Popup fits its browser surface',driver.find_element(By.TAG_NAME,'body').size['width']<=400)
    driver.find_element(By.TAG_NAME,'body').screenshot(str(root/'docs'/'popup.png'))
    (root/'tests'/'results-ui.json').write_text(json.dumps({'status':'passed','checks':len(checks),'passed':checks},indent=2))
    print(f'Captured actual library, settings, support and popup. {len(checks)} UI checks passed.')
finally:driver.quit();server.shutdown()
