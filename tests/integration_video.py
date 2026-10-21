"""Verify direct MP4/WebM Save As, local playback with sound, and app video UI.
Runs with disposable profiles and original bundled media; no social login needed.
"""
from pathlib import Path
import argparse,base64,functools,http.server,json,os,sys,threading,time,urllib.request,zipfile
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from PIL import Image
sys.stdout.reconfigure(encoding='utf-8')
parser=argparse.ArgumentParser();parser.add_argument('--browser',choices=['chrome','firefox'],default='firefox');target=parser.parse_args().browser
root=Path(__file__).resolve().parents[1];assets=root/'tests/assets/video';assets.mkdir(parents=True,exist_ok=True)
downloads=root/'tests/downloads'/('video-'+target+'-'+str(time.time_ns()));downloads.mkdir(parents=True)
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
def check(name,condition):assert condition,name;checks.append(name);print('PASS',target,name,flush=True)
def completed():
    wait.until(lambda d:ext('return (await browser.downloads.search({orderBy:["-startTime"],limit:1}))[0]?.state;')=='complete')
    return Path(ext('return (await browser.downloads.search({orderBy:["-startTime"],limit:1}))[0].filename;'))
result_path=root/'tests'/('results-video-'+target+'.json');result_path.write_text(json.dumps({'status':'running'}))
try:
    if target=='firefox':
        archive=assets/'video.xpi'
        with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
            for p in (root/'build/firefox').rglob('*'):
                if p.is_file():z.write(p,p.relative_to(root/'build/firefox').as_posix())
        addon=driver.install_addon(str(archive),temporary=True);driver.set_context('chrome');uuid=json.loads(driver.execute_script("return Services.prefs.getStringPref('extensions.webextensions.uuids')"))[addon];driver.execute_script((root/'tests/file-picker.js').read_text(encoding='utf-8'),str(downloads));driver.set_context('content');extension=f'moz-extension://{uuid}/'
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
    driver.switch_to.new_window('tab');driver.get(base+'/video.html');source=driver.current_window_handle
    wait.until(lambda d:driver.execute_script('return [...document.querySelectorAll("video")].every(v=>v.readyState>=1&&v.videoWidth===960)'))
    driver.switch_to.window(ui);tab=next(t for t in ext('return await browser.tabs.query({});') if t.get('url','')==base+'/video.html')
    before=set(driver.window_handles);ext('return await browser.runtime.sendMessage({type:"browse",tabId:arguments[0]});',tab['id']);wait.until(lambda d:bool(set(d.window_handles)-before));library=next(iter(set(driver.window_handles)-before));driver.switch_to.window(library)
    wait.until(lambda d:driver.find_element(By.CSS_SELECTOR,'[data-filter="video"]').is_enabled());driver.find_element(By.CSS_SELECTOR,'[data-filter="video"]').click()
    wait.until(lambda d:len(driver.find_elements(By.CSS_SELECTOR,'.media-card'))==2)
    check('Videos filter finds both direct MP4 and WebM files',all(any(ext in card.text.upper() for card in driver.find_elements(By.CSS_SELECTOR,'.media-card')) for ext in ['MP4','WEBM']))
    driver.find_element(By.ID,'load-all').click();wait.until(lambda d:driver.find_element(By.ID,'load-all').is_enabled())
    check('Video cards load poster previews and expose Save video',len(driver.find_elements(By.CSS_SELECTOR,'.preview img'))==2 and all('Save video' in card.text for card in driver.find_elements(By.CSS_SELECTOR,'.media-card')))
    driver.find_element(By.CSS_SELECTOR,'.preview img').click();wait.until(lambda d:driver.find_element(By.ID,'zoom-play').is_displayed())
    check('Video viewer waits for an explicit Play click',not driver.execute_script('return document.getElementById("zoom-video").hasAttribute("src")') and not driver.find_element(By.ID,'convert-tools').is_displayed())
    driver.execute_script('document.getElementById("zoom-video").volume=0');driver.find_element(By.ID,'zoom-play').click();wait.until(lambda d:driver.execute_script('const v=document.getElementById("zoom-video");return v.videoWidth===960&&v.currentTime>0.1&&!v.paused'))
    check('Direct video preview plays real frames with native controls',driver.execute_script('const v=document.getElementById("zoom-video");return v.controls&&v.videoHeight===640&&v.getVideoPlaybackQuality().totalVideoFrames>0'))
    if target=='chrome':
        driver.execute_cdp_cmd('Emulation.setDeviceMetricsOverride',{'width':1280,'height':800,'deviceScaleFactor':1,'mobile':False})
        driver.execute_script('const v=document.getElementById("zoom-video");v.pause();v.currentTime=1.2;v.volume=1;')
        wait.until(lambda d:driver.execute_script('return !document.getElementById("zoom-video").seeking'))
        from selenium.webdriver import ActionChains
        ActionChains(driver).move_to_element(driver.find_element(By.ID,'zoom-video')).perform()
        screenshot=driver.execute_cdp_cmd('Page.captureScreenshot',{'format':'png','captureBeyondViewport':False})
        picture=base64.b64decode(screenshot['data']);(root/'docs/video.png').write_bytes(picture);(root/'store/assets/video-1280x800.png').write_bytes(picture)
        driver.execute_cdp_cmd('Emulation.setDeviceMetricsOverride',{'width':320,'height':800,'deviceScaleFactor':1,'mobile':False})
        check('Video viewer fits a 320-pixel window',driver.execute_script('const d=document.getElementById("zoom");return document.documentElement.scrollWidth<=innerWidth&&d.scrollWidth<=d.clientWidth'))
        driver.execute_cdp_cmd('Emulation.clearDeviceMetricsOverride',{})
        driver.execute_async_script('const done=arguments[arguments.length-1];requestAnimationFrame(()=>requestAnimationFrame(()=>done()));')
    driver.find_element(By.ID,'close-zoom').click()
    wait.until(lambda d:driver.execute_script('const v=document.getElementById("zoom-video");return v.paused&&!v.hasAttribute("src")&&v.hidden'))
    check('Closing the viewer stops playback and releases its source',driver.execute_script('const v=document.getElementById("zoom-video");return v.paused&&!v.hasAttribute("src")&&v.hidden'))
    if target=='chrome':driver.execute_cdp_cmd('Browser.setDownloadBehavior',{'behavior':'allow','downloadPath':str(downloads),'eventsEnabled':True})
    for kind,mime in [('mp4','video/mp4'),('webm','video/webm')]:
        card=next(card for card in driver.find_elements(By.CSS_SELECTOR,'.media-card') if kind.upper() in card.text.upper())
        card.find_element(By.CSS_SELECTOR,'button.primary').click();wait.until(lambda d:'Sent to browser Downloads' in card.text);saved=completed()
        check(kind.upper()+' download finishes with the exact original bytes',saved.read_bytes()==(root/f'docs/demo/rightsave-demo.{kind}').read_bytes() and not list(downloads.glob('*.part')))
        # Decode the actual saved bytes, measure audio before a zero-volume output,
        # and inspect rendered frames. Nothing is sent to an external service.
        driver.switch_to.window(source)
        driver.execute_script('''
          window.__decoded=null;
          const video=document.createElement('video');video.preload='auto';video.src='data:'+arguments[0]+';base64,'+arguments[1];document.body.append(video);
          const button=document.createElement('button');button.id='decode-check';button.textContent='Check saved video';document.body.prepend(button);
          button.onclick=async()=>{try{
            const audio=new AudioContext(),analyser=audio.createAnalyser(),silent=audio.createGain();silent.gain.value=0;analyser.fftSize=2048;
            audio.createMediaElementSource(video).connect(analyser);analyser.connect(silent).connect(audio.destination);await audio.resume();await video.play();
            let rms=0;const signal=new Float32Array(analyser.fftSize);
            const sample=()=>{analyser.getFloatTimeDomainData(signal);rms=Math.max(rms,Math.sqrt(signal.reduce((sum,n)=>sum+n*n,0)/signal.length));
              if(video.currentTime<0.7){requestAnimationFrame(sample);return;}
              const result={width:video.videoWidth,height:video.videoHeight,duration:video.duration,time:video.currentTime,frames:video.getVideoPlaybackQuality().totalVideoFrames,audioRms:rms};
              video.pause();video.removeAttribute('src');video.load();audio.close();video.remove();button.remove();window.__decoded=result;
            };sample();
          }catch(e){window.__decoded={error:e.message};}};
        ''',mime,base64.b64encode(saved.read_bytes()).decode())
        driver.find_element(By.ID,'decode-check').click();wait.until(lambda d:driver.execute_script('return window.__decoded!==null'))
        playback=driver.execute_script('return window.__decoded')
        check('Saved '+kind.upper()+' decodes moving picture',playback.get('width')==960 and playback.get('height')==640 and playback.get('frames',0)>1 and playback.get('time',0)>.5)
        check('Saved '+kind.upper()+' retains a real audio track',playback.get('audioRms',0)>.0001)
        driver.switch_to.window(library)
    driver.switch_to.window(source);driver.execute_script('const v=document.getElementById("sample-mp4");v.volume=0;v.play();');wait.until(lambda d:driver.execute_script('return document.getElementById("sample-mp4").readyState>=2'));driver.switch_to.window(library)
    mp4=next(card for card in driver.find_elements(By.CSS_SELECTOR,'.media-card') if 'MP4' in card.text.upper());mp4.find_element(By.CSS_SELECTOR,'.text-button').click();wait.until(lambda d:'Sent to browser Downloads' in mp4.text);frame=completed()
    with Image.open(frame) as image:check('Save frame captures the current video as a full-size PNG',image.format=='PNG' and image.size==(960,640))
    driver.switch_to.window(source);driver.execute_script('const v=document.createElement("video");v.src="missing-video.mp4";v.poster="video-poster.png";v.setAttribute("aria-label","Unavailable test video");document.body.append(v);');driver.switch_to.window(library)
    driver.find_element(By.ID,'rescan').click();wait.until(lambda d:len(driver.find_elements(By.CSS_SELECTOR,'.media-card'))==3)
    bad=next(card for card in driver.find_elements(By.CSS_SELECTOR,'.media-card') if 'Unavailable test video' in card.text);bad.find_element(By.CSS_SELECTOR,'.video-preview').click();wait.until(lambda d:driver.find_element(By.ID,'zoom-play').is_displayed());driver.find_element(By.ID,'zoom-play').click();wait.until(lambda d:'could not play here' in driver.find_element(By.ID,'zoom-status').text)
    check('A blocked video preview keeps Save original available with a clear fallback',driver.find_element(By.ID,'zoom-save').is_enabled() and driver.find_element(By.ID,'zoom-play').text=='Retry video preview')
    driver.find_element(By.ID,'close-zoom').click()
    driver.switch_to.window(ui);driver.get(extension+'support.html#practice-video');wait.until(lambda d:driver.find_element(By.ID,'practice-video-save').is_displayed())
    check('Built-in video practice and walkthrough are visible',driver.find_element(By.ID,'practice-video-player').get_attribute('controls') is not None and driver.find_element(By.CSS_SELECTOR,'[data-guide="video"]').is_enabled())
    if target=='chrome':
        driver.execute_cdp_cmd('Browser.setDownloadBehavior',{'behavior':'allow','downloadPath':str(downloads),'eventsEnabled':True})
        driver.execute_script('const original=browser.downloads.download.bind(browser.downloads);window.__practiceSaveAs=null;browser.downloads.download=options=>{__practiceSaveAs=options.saveAs;return original({...options,saveAs:false});};')
    driver.find_element(By.ID,'practice-video-save').click();wait.until(lambda d:'Practice video sent' in driver.find_element(By.ID,'practice-video-status').text);practice=completed()
    check('Practice video Save As produces the complete bundled file',practice.read_bytes()==(root/'extension/practice.webm').read_bytes())
    if target=='chrome':check('Chrome video saves preserve native Save As requests',driver.execute_script('return window.__practiceSaveAs') is True)
    result_path.write_text(json.dumps({'status':'passed','checks':len(checks),'passed':checks,'browser':driver.capabilities['browserVersion']},indent=2))
finally:driver.quit();server.shutdown()
