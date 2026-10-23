"""Koofr shared-link behavior in disposable browser profiles.
The fixture uses Koofr's published URL/schema shapes; only test copies accept localhost.
No cloud account or real shared files are accessed.
"""
from pathlib import Path
import argparse,functools,http.server,json,os,re,shutil,threading,time,urllib.parse,urllib.request,zipfile
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver import ActionChains
from selenium.webdriver.support.ui import WebDriverWait
parser=argparse.ArgumentParser();parser.add_argument('--browser',choices=['firefox','chrome'],required=True);target=parser.parse_args().browser
root=Path(__file__).resolve().parents[1];assets=root/'tests/assets';test_copy=assets/('koofr-'+target)
shutil.copytree(root/'build'/target,test_copy,dirs_exist_ok=True)
for file in ['shared.js','sites.js','page-bridge.js']:
    p=test_copy/file;s=p.read_text(encoding='utf-8').replace('app.koofr.net','127.0.0.1')
    if file=='shared.js':s=s.replace('url.protocol !== "https:"','url.protocol !== "http:"')
    p.write_text(s,encoding='utf-8')
manifest=json.loads((test_copy/'manifest.json').read_text());manifest['content_scripts'][1]['matches'].append('http://127.0.0.1/links/*');(test_copy/'manifest.json').write_text(json.dumps(manifest))
downloads=assets/('koofr-downloads-'+target+'-'+str(time.time_ns()));downloads.mkdir()
requests=[]
class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*_):pass
    def do_GET(self):
        u=urllib.parse.urlparse(self.path);query=urllib.parse.parse_qs(u.query);path=query.get('path',['/'])[0]
        if u.path.startswith('/api/v2/public/links/'):
            if u.path.endswith('/bundle'):
                data={'file':{'type':'dir','name':'folder'},'files':[{'name':'photo.png','type':'file','contentType':'image/png'},{'name':'clip.webm','type':'file','contentType':'video/webm'}]} if path=='/folder' else {'file':{'name':'clip.webm','type':'file','contentType':'video/webm'}}
            else:data={'file':{'name':'photo.png','type':'file','contentType':'image/png'},'ownerEmail':'PRIVATE_DO_NOT_STORE'}
            payload=json.dumps(data).encode();mime='application/json'
        elif u.path.startswith('/content/links/'):
            thumbnail='thumb' in query
            if query.get('password')!=['allowed'] or 'koofr-test=allowed' not in (self.headers.get('Cookie') or ''):
                self.send_error(403);return
            if not thumbnail:
                requests.append({'path':path,'referer':self.headers.get('Referer')})
                if target=='firefox' and self.headers.get('Referer')!=base+'/links/ShareTest':self.send_error(403);return
            file='background.png' if thumbnail else ('video.webm' if path.endswith('.webm') else 'image.png')
            payload=(assets/file).read_bytes();mime='video/webm' if file.endswith('webm') else 'image/png'
        elif u.path.startswith('/links/'):
            html='''<!doctype html><html><head><title>Koofr shared-file fixture</title><style>img,video{width:320px;height:200px}.media{position:relative;display:inline-block}.overlay{position:absolute;inset:0}</style></head><body>
<div class="media"><img id="image" src="/content/links/ShareTest/files/get?path=%2F&amp;thumb=huge&amp;password=allowed"><div id="overlay" class="overlay"></div></div>
<video id="video" hidden></video><button id="load">Load file details</button><button id="blob">Use blob preview</button><button id="clip">Open clip</button><button id="folder">Open folder</button>
<script>
window.blocked=0;addEventListener('contextmenu',e=>{blocked++;e.preventDefault()});
const img=document.getElementById('image'),video=document.getElementById('video');
const metadata=()=>fetch('/api/v2/public/links/ShareTest'+(location.search.includes('path=')?'/bundle?'+location.search.slice(1)+'&':'?')+'password=allowed').then(r=>r.json()).then(data=>window.lastPayload=data);
document.getElementById('load').onclick=metadata;
document.getElementById('blob').onclick=()=>fetch(img.src).then(r=>r.blob()).then(b=>img.src=URL.createObjectURL(b));
document.getElementById('clip').onclick=()=>{history.pushState({},'', '/links/ShareTest?path=%2Fclip.webm');img.parentElement.hidden=true;video.hidden=false;video.poster='/content/links/ShareTest/files/get?path=%2Fclip.webm&thumb=huge&password=allowed';video.src=URL.createObjectURL(new Blob([],{type:'video/webm'}));metadata()};
document.getElementById('folder').onclick=()=>{history.pushState({},'', '/links/ShareTest?path=%2Ffolder');video.removeAttribute('poster');metadata()};
</script></body></html>'''
            payload=html.encode();mime='text/html'
        else:self.send_error(404);return
        self.send_response(200);self.send_header('Content-Type',mime);self.send_header('Content-Length',str(len(payload)));self.send_header('Set-Cookie','koofr-test=allowed; Path=/; SameSite=Lax')
        if u.path.startswith('/content/links/') and 'thumb' not in query:self.send_header('Content-Disposition','attachment; filename="original-name.'+('webm' if path.endswith('.webm') else 'png')+'"')
        self.end_headers();self.wfile.write(payload)
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler);base=f'http://127.0.0.1:{server.server_port}';threading.Thread(target=server.serve_forever,daemon=True).start()
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
result_file=root/'tests'/('results-koofr-'+target+'.json');result_file.write_text(json.dumps({'status':'running'}))
def ext(script,*args):return driver.execute_async_script('const done=arguments[arguments.length-1];(async()=>{'+script+'})().then(done,e=>done({error:e.message}));',*args)
try:
    if target=='firefox':
        archive=assets/'koofr-firefox.xpi'
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
        ws.send(json.dumps({'id':1,'method':'Runtime.evaluate','params':{'expression':"globalThis.__options=[];const actual=chrome.downloads.download.bind(chrome.downloads);chrome.downloads.download=async o=>{__options.push({...o});return await actual({...o,saveAs:false});};true"}}))
        while json.loads(ws.recv()).get('id')!=1:pass
        driver.execute_cdp_cmd('Browser.setDownloadBehavior',{'behavior':'allow','downloadPath':str(downloads)})
    driver.get(extension+'options.html');ui=driver.current_window_handle
    wait.until(lambda d:ext('return (await browser.tabs.query({})).some(t=>t.url===browser.runtime.getURL("welcome.html"));'))
    ext('await browser.tabs.remove((await browser.tabs.query({})).filter(t=>t.url===browser.runtime.getURL("welcome.html")).map(t=>t.id));await browser.storage.local.set({quickSave:false});return true;')
    if target=='chrome':driver.execute_cdp_cmd('Browser.setDownloadBehavior',{'behavior':'allow','downloadPath':str(downloads)})
    driver.switch_to.new_window('tab');source=driver.current_window_handle;driver.get(base+'/links/ShareTest')
    wait.until(lambda d:driver.execute_script('return document.images[0].complete'))
    driver.switch_to.window(ui)
    tab_id=next(t['id'] for t in ext('return await browser.tabs.query({});') if t.get('url','').startswith(base+'/links/'))
    def collect():return ext('return (await browser.scripting.executeScript({target:{tabId:arguments[0]},func:()=>globalThis.__rightSave.collect()}))[0].result.items;',tab_id)
    def context_click(element):
        driver.switch_to.window(source);ActionChains(driver).context_click(driver.find_element(By.ID,element)).send_keys(Keys.ESCAPE).perform();driver.switch_to.window(ui)
        return ext('return await browser.tabs.sendMessage(arguments[0],{type:"context"});',tab_id)
    def save(item,expected):
        result=ext('return await browser.runtime.sendMessage({type:"save",tabId:arguments[0],item:arguments[1],template:"original-name.{ext}"});',tab_id,item);assert isinstance(result.get('id'),int),result
        wait.until(lambda d:ext('return (await browser.downloads.search({id:arguments[0]}))[0]?.state;',result['id'])=='complete')
        saved=Path(ext('return (await browser.downloads.search({id:arguments[0]}))[0].filename;',result['id']))
        check('Saved original bytes for '+expected,saved.read_bytes()==(assets/expected).read_bytes())
        if target=='firefox':name=saved.name
        else:
            ws.send(json.dumps({'id':9,'method':'Runtime.evaluate','params':{'expression':'__options.at(-1)','returnByValue':True}}))
            while True:
                response=json.loads(ws.recv())
                if response.get('id')==9:break
            options=response['result']['result']['value'];name=options['filename'];check('Native Save As stays enabled',options['saveAs'] is True)
        check('Fresh random name retains '+expected.rsplit('.',1)[-1],bool(re.fullmatch(r'[a-f0-9]{32}\.'+expected.rsplit('.',1)[-1],name)))
        return name
    driver.switch_to.window(source);driver.find_element(By.ID,'load').click();driver.switch_to.window(ui)
    wait.until(lambda d:any(i['source']=='Koofr original' for i in collect()))
    check('Shared-file metadata reaches the isolated scanner',any('photo.png' in i['url'] and i['source']=='Koofr original' for i in collect()))
    check('Owner details are discarded','PRIVATE_DO_NOT_STORE' not in json.dumps(collect()))
    items=context_click('overlay');original=items[0]
    check('Right-click under an overlay selects original instead of thumbnail',original['source']=='Koofr original' and 'thumb=' not in original['url'] and 'password=allowed' in original['url'])
    first=save(original,'image.png')
    driver.switch_to.window(source);check('Website right-click blocker is suppressed',driver.execute_script('return blocked===0'));driver.find_element(By.ID,'blob').click();wait.until(lambda d:driver.execute_script('return document.images[0].src.startsWith("blob:")'));driver.switch_to.window(ui)
    items=context_click('overlay');check('Blob image preview resolves to the current shared original',items[0]['source']=='Koofr original')
    check('Gallery scan replaces the blob preview with its known original',not any(i['url'].startswith('blob:') for i in collect()))
    second=save(items[0],'image.png');check('Saving the same file again produces a different random name',first!=second)
    driver.switch_to.window(source);driver.find_element(By.ID,'clip').click();driver.switch_to.window(ui)
    wait.until(lambda d:any(i['kind']=='video' and i['source']=='Koofr original' for i in collect()))
    items=context_click('video');video=next(i for i in items if i['kind']=='video')
    check('Blob video resolves to the matching complete file',not video['url'].startswith('blob:') and 'clip.webm' in urllib.parse.unquote(video['url']))
    save(video,'video.webm')
    check('Original requests keep the shared path and required session',len(requests)==3 and (target!='firefox' or all(r['referer']==base+'/links/ShareTest' for r in requests)))
    driver.switch_to.window(source);driver.find_element(By.ID,'folder').click();driver.switch_to.window(ui)
    wait.until(lambda d:len([i for i in collect() if i['source']=='Koofr original'])>=2)
    check('Shared folder metadata exposes image and video children',all(any('/folder/'+name in urllib.parse.unquote(i['url']) for i in collect()) for name in ['photo.png','clip.webm']))
    items=context_click('video');check('An unidentified folder blob never selects an unrelated child',not any(i['source']=='Koofr original' for i in items))
    ext('await browser.storage.local.set({enhancedDetection:false});return true;')
    wait.until(lambda d:not any(i['source']=='Koofr original' for i in collect()))
    check('Disabling enhanced detection clears Koofr metadata',True)
    result_file.write_text(json.dumps({'status':'passed','browser':driver.capabilities['browserVersion'],'checks':len(checks),'passed':checks},indent=2))
finally:
    driver.quit();server.shutdown()
    if 'ws' in globals():ws.close()
