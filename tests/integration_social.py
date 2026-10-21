"""Exercise the real isolated/main-world bridge in both browsers using local fixtures.
Only the disposable test copy adds localhost as an Instagram-shaped test host.
This never visits social accounts or changes the distributed matches/host adapter."""
from pathlib import Path
import argparse,functools,http.server,json,os,shutil,sys,threading,time,urllib.parse,urllib.request,zipfile
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver import ActionChains
from selenium.webdriver.support.ui import WebDriverWait

parser=argparse.ArgumentParser();parser.add_argument('--browser',choices=['firefox','chrome'],required=True)
target=parser.parse_args().browser
root=Path(__file__).resolve().parents[1];assets=root/'tests'/'assets'
assert (assets/'video.webm').exists(),'Run integration_firefox.py first.'
test_copy=assets/('social-'+target);shutil.copytree(root/'build'/target,test_copy,dirs_exist_ok=True)
sites=test_copy/'sites.js';sites.write_text(sites.read_text(encoding='utf-8').replace('const definitions = [','const definitions = [["127.0.0.1", "Instagram"],'),encoding='utf-8')
manifest=json.loads((test_copy/'manifest.json').read_text());manifest['content_scripts'][1]['matches'].append('http://127.0.0.1/*')
(test_copy/'manifest.json').write_text(json.dumps(manifest))
downloads=assets/('social-downloads-'+target+'-'+str(int(time.time())));downloads.mkdir()

class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*_):pass
    def do_GET(self):
        path=urllib.parse.urlparse(self.path)
        if path.path.startswith('/api/v1/'):
            code=urllib.parse.parse_qs(path.query).get('post',['PostAbC'])[0]
            data={'secret':'THIS_MUST_NOT_BE_STORED','items':[{'code':code,'display_url':base+'/poster.png','video_versions':[{'url':base+'/low-'+code+'.webm','width':640,'height':360},{'url':base+'/high-'+code+'.webm','width':1280,'height':720}]}]}
            payload=json.dumps(data).encode();self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(payload)));self.end_headers();self.wfile.write(payload);return
        if path.path.endswith('.webm'):
            payload=(assets/'video.webm').read_bytes();self.send_response(200);self.send_header('Content-Type','video/webm');self.send_header('Content-Length',str(len(payload)));self.end_headers();self.wfile.write(payload);return
        if path.path in ['/poster.png','/static-poster.png']:
            payload=(assets/'image.png').read_bytes();self.send_response(200);self.send_header('Content-Type','image/png');self.end_headers();self.wfile.write(payload);return
        if path.path in ['/','/p/Next/']:
            static=json.dumps({'code':'StaticAbC','display_url':base+'/static-poster.png','video_versions':[{'url':base+'/static.webm','width':320,'height':180}]})
            html='''<!doctype html><html><head><title>Social bridge fixture</title></head><body><script type="application/json">STATIC</script><article><a href="/p/PostAbC/">Post</a><video id="video" width="320" height="200" poster="/poster.png"></video></article><button id="fetch">Fetch post</button><button id="xhr">XHR post</button><script>
const video=document.getElementById('video');video.src=URL.createObjectURL(new Blob([], {type:'video/mp4'}));
document.getElementById('fetch').onclick=()=>fetch('/api/v1/feed?post='+ (location.pathname.includes('Next')?'Next':'PostAbC')).then(r=>r.json()).then(x=>window.originalPayload=x);
document.getElementById('xhr').onclick=()=>{const x=new XMLHttpRequest();x.open('GET','/api/v1/feed?post=XhrPost');x.responseType='json';x.onload=()=>window.xhrPayload=x.response;x.send();};
</script></body></html>'''.replace('STATIC',static)
            payload=html.encode();self.send_response(200);self.send_header('Content-Type','text/html');self.end_headers();self.wfile.write(payload);return
        super().do_GET()
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(assets)))
base=f'http://127.0.0.1:{server.server_port}';threading.Thread(target=server.serve_forever,daemon=True).start()
checks=[]
def check(name,value):assert value,name;checks.append(name);print('PASS',target,name,flush=True)
if target=='firefox':
    from selenium.webdriver.firefox.options import Options
    from selenium.webdriver.firefox.service import Service
    options=Options();options.add_argument('-headless');options.binary_location=os.environ.get('FIREFOX_BINARY',r'C:\Program Files\Mozilla Firefox\firefox.exe')
    driver=webdriver.Firefox(options=options,service=Service(service_args=['--allow-system-access']))
else:
    from selenium.webdriver.chrome.options import Options
    options=Options();options.add_argument('--headless=new');options.add_argument('--remote-allow-origins=*')
    if os.environ.get('CHROMIUM_BINARY'):options.binary_location=str(Path(os.environ['CHROMIUM_BINARY']).resolve())
    options.add_argument('--load-extension='+str(test_copy));options.add_argument('--disable-extensions-except='+str(test_copy));options.add_experimental_option('enableExtensionTargets',True)
    driver=webdriver.Chrome(options=options)
wait=WebDriverWait(driver,15);driver.set_window_size(1280,1000)
result_file=root/'tests'/('results-social-'+target+'.json');result_file.write_text(json.dumps({'status':'running'}))
def ext(script,*args):return driver.execute_async_script('const done=arguments[arguments.length-1];(async()=>{'+script+'})().then(done,e=>done({error:e.message}));',*args)
try:
    if target=='firefox':
        archive=assets/'social-firefox.xpi'
        with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
            for p in test_copy.rglob('*'):
                if p.is_file():z.write(p,p.relative_to(test_copy).as_posix())
        addon=driver.install_addon(str(archive),temporary=True);driver.set_context('chrome')
        uuid=json.loads(driver.execute_script("return Services.prefs.getStringPref('extensions.webextensions.uuids')"))[addon]
        driver.execute_script((root/'tests'/'file-picker.js').read_text(),str(downloads));driver.set_context('content');extension=f'moz-extension://{uuid}/'
    else:
        wait.until(lambda d:any(t['type']=='service_worker' and t['url'].endswith('/worker.js') for t in d.execute_cdp_cmd('Target.getTargets',{})['targetInfos']))
        worker=next(t for t in driver.execute_cdp_cmd('Target.getTargets',{})['targetInfos'] if t['type']=='service_worker' and t['url'].endswith('/worker.js'));extension=worker['url'].rsplit('/',1)[0]+'/'
        import websocket
        debug=driver.capabilities['goog:chromeOptions']['debuggerAddress'];targets=json.load(urllib.request.urlopen('http://'+debug+'/json'));worker=next(t for t in targets if t['url'].endswith('/worker.js'))
        ws=websocket.create_connection(worker['webSocketDebuggerUrl'],suppress_origin=True)
        ws.send(json.dumps({'id':1,'method':'Runtime.evaluate','params':{'expression':"globalThis.__options=[];const actual=chrome.downloads.download.bind(chrome.downloads);chrome.downloads.download=o=>{__options.push({...o});return new Promise((resolve,reject)=>actual({...o,saveAs:false},id=>chrome.runtime.lastError?reject(new Error(chrome.runtime.lastError.message)):resolve(id)));};true"}}))
        while json.loads(ws.recv()).get('id')!=1:pass
        driver.execute_cdp_cmd('Browser.setDownloadBehavior',{'behavior':'allow','downloadPath':str(downloads)})
    driver.get(extension+'options.html');ui=driver.current_window_handle
    wait.until(lambda d:ext('return (await browser.tabs.query({})).some(t=>t.url===browser.runtime.getURL("welcome.html"));'))
    check('First install opens the bundled quick-start page',True)
    ext('await browser.tabs.remove((await browser.tabs.query({})).filter(t=>t.url===browser.runtime.getURL("welcome.html")).map(t=>t.id));await browser.storage.local.set({quickSave:false});return true;')
    driver.switch_to.new_window('tab');source=driver.current_window_handle;driver.get(base)
    driver.switch_to.window(ui)
    tab_id=next(t['id'] for t in ext('return await browser.tabs.query({});') if t.get('url','').rstrip('/')==base)
    def collect():return ext('return (await browser.scripting.executeScript({target:{tabId:arguments[0]},func:()=>globalThis.__rightSave.collect()}))[0].result.items;',tab_id)
    wait.until(lambda d:any('static.webm' in i['url'] for i in collect()))
    check('Embedded page JSON exposes a hidden progressive video',any('static.webm' in i['url'] for i in collect()))
    driver.switch_to.window(source)
    driver.execute_script("window.bridgeMessages=[];addEventListener('message',e=>{if(e.data?.rightsave)bridgeMessages.push({type:e.data.rightsave,enabled:e.data.enabled,source:e.source===window})});")
    driver.find_element(By.ID,'fetch').click()
    wait.until(lambda d:d.execute_script('return !!window.originalPayload'))
    check('Fetch observation leaves the site response unchanged',driver.execute_script('return window.originalPayload.secret')=='THIS_MUST_NOT_BE_STORED')
    driver.switch_to.window(ui)
    try:wait.until(lambda d:any('high-PostAbC' in i['url'] for i in collect()))
    except Exception:
        print('COLLECT',collect(),flush=True);driver.switch_to.window(source);print('MESSAGES',driver.execute_script('return bridgeMessages'),flush=True);raise
    check('Main-world fetch data reaches the isolated scanner',any('high-PostAbC' in i['url'] for i in collect()))
    check('Only extracted media fields survive observation','THIS_MUST_NOT_BE_STORED' not in json.dumps(collect()))
    driver.switch_to.window(source);ActionChains(driver).context_click(driver.find_element(By.ID,'video')).send_keys(Keys.ESCAPE).perform();driver.switch_to.window(ui)
    candidates=ext('return await browser.tabs.sendMessage(arguments[0],{type:"context"});',tab_id)
    winner=next(i for i in candidates if i['kind']=='video')
    check('Right-click resolves blob playback to the matching highest-quality file','high-PostAbC' in winner['url'])
    result=ext('return await browser.runtime.sendMessage({type:"save",tabId:arguments[0],item:arguments[1]});',tab_id,winner)
    assert isinstance(result.get('id'),int),result
    wait.until(lambda d:ext('return (await browser.downloads.search({id:arguments[0]}))[0]?.state;',result['id'])=='complete')
    saved=Path(ext('return (await browser.downloads.search({id:arguments[0]}))[0].filename;',result['id']))
    check('Resolved social video saves complete original bytes',saved.read_bytes()==(assets/'video.webm').read_bytes())
    driver.switch_to.window(source);driver.find_element(By.ID,'xhr').click();wait.until(lambda d:d.execute_script('return !!window.xhrPayload'))
    driver.switch_to.window(ui);wait.until(lambda d:any('high-XhrPost' in i['url'] for i in collect()))
    check('XHR JSON responses are also observed',any('high-XhrPost' in i['url'] for i in collect()))
    ext('await browser.storage.local.set({enhancedDetection:false});return true;')
    wait.until(lambda d:not any('page data' in i['source'] for i in collect()))
    check('Disabling enhanced detection clears cached media',not any('page data' in i['source'] for i in collect()))
    ext('await browser.storage.local.set({enhancedDetection:true});return true;')
    driver.switch_to.window(source);driver.find_element(By.ID,'fetch').click();driver.switch_to.window(ui)
    wait.until(lambda d:any('high-PostAbC' in i['url'] for i in collect()))
    check('Detection resumes after re-enabling',True)
    driver.switch_to.window(source);driver.execute_script("history.pushState({},'', '/p/Next/');");driver.switch_to.window(ui)
    check('SPA navigation clears prior-post data and skips unchanged old JSON',not any('page data' in i['source'] for i in collect()))
    driver.switch_to.window(source);driver.find_element(By.ID,'fetch').click();driver.switch_to.window(ui)
    wait.until(lambda d:any('high-Next' in i['url'] for i in collect()))
    check('New-route media can be observed after navigation',True)
    driver.switch_to.window(source);driver.execute_script("postMessage({rightsave:'json-v1',pageURL:location.href,text:JSON.stringify({video_url:'javascript:alert(1)'})},location.origin)");driver.switch_to.window(ui)
    check('Forged executable media URLs are discarded',all(not i['url'].startswith('javascript:') for i in collect()))
    ext('await browser.storage.local.set({disabledSites:["127.0.0.1"]});return true;')
    wait.until(lambda d:not any('page data' in i['source'] for i in collect()))
    check('Site exceptions clear enhanced detection on that host',True)
    result_file.write_text(json.dumps({'status':'passed','browser':driver.capabilities['browserVersion'],'checks':len(checks),'passed':checks},indent=2))
    print(f'{target}: {len(checks)} social integration checks passed.')
finally:
    driver.quit();server.shutdown()
    if 'ws' in globals():ws.close()
