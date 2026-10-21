(async () => {
  const U=RightSaveUtil, $=id=>document.getElementById(id);
  const key="picker:"+new URL(location.href).searchParams.get("session");
  const data=(await browser.storage.session.get(key))[key];
  const plan=await RightSaveCommerce.status();
  const settings=await browser.storage.local.get({thumbnailSize:"large",theme:"dark",quickSave:true});
  document.documentElement.dataset.theme=settings.theme;
  $("plan-label").textContent=plan.plan==="pro"?"Pro":plan.plan==="supporter"?"Supporter":"Free";
  $("pro-note").textContent=plan.pro?"Pro workflows are active on this browser.":"Pro adds ZIP collections, saved workflows, batch naming, dimension filters and list export. Individual saves stay free.";
  $("pro-link").hidden=plan.pro;
  for(const id of ["min-width","select-visible","template","preset","preset-name","apply-preset","delete-preset","save-preset","export"])$(id).disabled=!plan.pro;
  function notice(text){$("notice").hidden=!text;$("notice").textContent=text;}
  $("quick-toggle").checked=settings.quickSave;
  $("quick-toggle").onchange=async()=>{await browser.storage.local.set({quickSave:$("quick-toggle").checked});notice($("quick-toggle").checked?"Right-click Save As enabled on active sites.":"Use the RightSave submenu when you right-click media.");};
  if(!data){notice("This library expired. Return to the source webpage and open RightSave again.");$("rescan").disabled=true;$("load-all").disabled=true;return;}
  let filter="all",size=settings.thumbnailSize,busy=false;
  const selected=new Set(),previews=new Map(),rows=new Map();
  const id=item=>`${item.frameId||0}:${item.kind}:${item.url}`;
  const send=message=>browser.runtime.sendMessage({...message,tabId:data.tabId});
  $("heading").textContent=data.title.includes("spot")?"At this spot.":"Media.";$("pageTitle").textContent=data.pageTitle;notice(data.notice);
  function visibleItems(){
    const query=$("search").value.toLowerCase(),min=plan.pro?Number($("min-width").value)||0:0;
    let values=data.items.filter(item=>(filter==="all"||item.kind===filter)&&(!min||(item.width||0)>=min)&&(!query||[item.label,item.source,U.filename(item),item.url].join(" ").toLowerCase().includes(query)));
    if($("sort").value==="largest") values.sort((a,b)=>(b.width||0)*(b.height||0)-(a.width||0)*(a.height||0));
    if($("sort").value==="name") values.sort((a,b)=>U.filename(a).localeCompare(U.filename(b)));
    return values;
  }
  function updateSelection(){
    $("save-selected").textContent=`Save selected (${selected.size})`;$("save-selected").disabled=!selected.size||busy;
    $("save-zip").disabled=!plan.pro||!selected.size||busy;
    const available=visibleItems().filter(i=>!U.issue(i));
    $("select-visible").checked=available.length>0&&available.every(i=>selected.has(id(i)));
    $("select-visible").indeterminate=available.some(i=>selected.has(id(i)))&&!$("select-visible").checked;
  }
  function showPreview(item){
    const row=rows.get(id(item)),cache=previews.get(id(item));
    if(!row||!cache?.image)return;
    row.preview.replaceChildren(cache.image);
    row.preview.classList.add("ready");
    cache.image.onclick=()=>{$("zoom-image").src=cache.image.src;$("zoom").showModal();};
  }
  async function loadPreview(item){
    const identity=id(item),existing=previews.get(identity);
    if(existing?.image){showPreview(item);return true;}
    if(existing?.promise)return existing.promise;
    const task=(async()=>{
      const row=rows.get(identity);if(row)row.load.textContent="Loading…";
      try{
        let url=item.kind==="video"?item.poster:item.url;
        if(!url||/^(canvas:|svg:|blob:)/.test(url)){
          const result=await send({type:"preview",item});if(result.error)throw new Error(result.error);url=result.url;
        }
        const img=new Image();img.alt=item.label||U.filename(item);img.referrerPolicy="no-referrer";
        await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{img.src="";reject(new Error("Preview timed out."));},12000);img.onload=()=>{clearTimeout(timer);resolve();};img.onerror=()=>{clearTimeout(timer);reject(new Error("This host could not provide a preview."));};img.src=url;});
        previews.set(identity,{image:img});showPreview(item);return true;
      }catch(error){previews.delete(identity);const current=rows.get(identity);if(current){current.load.textContent="Retry preview";current.load.title=error.message;}return false;}
    })();
    previews.set(identity,{promise:task});return task;
  }
  function render(){
    rows.clear();$("media").replaceChildren();$("media").classList.toggle("size-xl",size==="xl");
    document.querySelectorAll("[data-size]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.size===size)));
    const values=visibleItems();$("count").textContent=`${values.length} ${values.length===1?"item":"items"}${data.items.length>=1000?" · first 1,000":""}`;$("empty").hidden=values.length>0;
    for(const item of values){
      const identity=id(item),issue=U.issue(item),card=document.createElement("article");card.className="media-card";
      const preview=document.createElement("div");preview.className="preview";
      const symbol=document.createElement("span");symbol.className="media-symbol";symbol.textContent=item.kind==="video"?"▷":"▧";
      const load=document.createElement("button");load.className="preview-button";load.textContent=item.kind==="video"?"Load frame preview":"Load preview";load.onclick=()=>loadPreview(item);preview.append(symbol,load);
      const body=document.createElement("div");body.className="card-body";
      const source=document.createElement("p");source.className="source";source.textContent=item.source;
      const heading=document.createElement("h2");heading.textContent=item.label||U.filename(item);heading.title=heading.textContent;
      const detail=document.createElement("p");detail.className="detail";
      let host="";try{host=new URL(item.url).hostname;}catch{}
      detail.textContent=[item.width&&item.height?`${item.width} × ${item.height}`:"Dimensions unavailable",item.audio==="separate"?"Video only · separate audio":item.audio==="none"?"No audio in source":"",host].filter(Boolean).join(" · ");
      const warning=item.audio==="separate"?"Audio is delivered separately. This saves the video track only; audio merging is not available in this build.":"";
      const problem=document.createElement("p");problem.className="problem";problem.textContent=issue||warning;problem.hidden=!(issue||warning);
      const actions=document.createElement("div");actions.className="card-actions";
      const save=document.createElement("button");save.className="primary";save.textContent=item.audio==="separate"?"Save video only":`Save ${item.kind}`;save.disabled=!!issue;
      const status=document.createElement("p");status.className="status";status.setAttribute("role","status");
      const act=async(type,button)=>{button.disabled=true;status.textContent="Opening Save As…";try{const result=await send({type,item});status.textContent=result.error||(result.id===null?"Save canceled.":"Sent to browser Downloads. Check its progress there.");}catch{status.textContent="Could not start the download. Rescan the source page and try again.";}button.disabled=type==="save"&&!!issue;};
      save.onclick=()=>act("save",save);actions.append(save);
      if(item.kind==="video"&&item.ref){const frame=document.createElement("button");frame.className="text-button";frame.textContent="Save frame";frame.onclick=()=>act("video-frame",frame);actions.append(frame);}
      if(/^(https?:|file:)/.test(item.url)){const link=document.createElement("a");link.className="text-link";link.textContent="Open original";link.href=item.url;link.target="_blank";link.rel="noreferrer";actions.append(link);}
      const selection=document.createElement("label");selection.className="tile-select";selection.hidden=!plan.pro;const box=document.createElement("input");box.type="checkbox";box.checked=selected.has(identity);box.disabled=!!issue||!plan.pro;box.setAttribute("aria-label","Select "+heading.textContent);box.onchange=()=>{box.checked?selected.add(identity):selected.delete(identity);updateSelection();};selection.append(box,document.createTextNode("Select"));
      body.append(source,heading,detail,problem,actions,status);card.append(preview,selection,body);rows.set(identity,{preview,load,box});$("media").append(card);showPreview(item);
    }
    updateSelection();
  }
  $("load-all").onclick=async()=>{
    const values=[...visibleItems()];let cursor=0,loaded=0,failed=0;
    $("load-all").disabled=true;
    try{await Promise.all(Array.from({length:Math.min(6,values.length)},async()=>{while(cursor<values.length){const item=values[cursor++];await loadPreview(item)?loaded++:failed++;$("load-all").textContent=`Loading ${loaded+failed} / ${values.length}…`;}}));notice(`Loaded ${loaded} previews${failed?`; ${failed} unavailable. Some hosts block previews, or a video needs to be playing.`:"."}`);}
    finally{$("load-all").textContent="Load all previews";$("load-all").disabled=false;}
  };
  document.querySelectorAll("[data-filter]").forEach(b=>b.onclick=()=>{filter=b.dataset.filter;document.querySelectorAll("[data-filter]").forEach(e=>e.setAttribute("aria-pressed",String(e===b)));render();});
  document.querySelectorAll("[data-size]").forEach(b=>b.onclick=async()=>{size=b.dataset.size;await browser.storage.local.set({thumbnailSize:size});render();});
  for(const control of ["search","sort","min-width"])$(control).addEventListener(control==="sort"?"change":"input",()=>{if(control==="min-width"&&!plan.pro){$(control).value="0";notice("Dimension filters are a Pro workflow. Core saving is free.");}render();});
  $("select-visible").onchange=()=>{for(const item of visibleItems().filter(i=>!U.issue(i)))$("select-visible").checked?selected.add(id(item)):selected.delete(id(item));render();};
  $("rescan").onclick=async()=>{if(busy)return;$("rescan").disabled=true;try{const result=await send({type:"rescan"});if(result.error)notice(result.error);else{data.items=result.items;data.title="Media on this page";data.notice="";data.created=Date.now();selected.clear();await browser.storage.session.set({[key]:data});$("heading").textContent="Media.";notice("");render();}}catch{notice("Rescan failed. Return to the source page and open RightSave again.");}finally{$("rescan").disabled=false;}};
  $("save-selected").onclick=async()=>{
    if(!plan.pro){notice("Batch saving is a Pro workflow. Individual saves stay free.");return;}
    const items=data.items.filter(i=>selected.has(id(i)));if(items.length>100){notice("Select up to 100 files per batch.");return;}
    busy=true;updateSelection();notice(`Opening Save As for ${items.length} files. Cancel any dialog to stop the queue.`);
    try{const result=await send({type:"save-batch",items,template:$("template").value.trim()});notice(result.error||`${result.results.filter(r=>r.id!==null).length} files sent to browser Downloads.${result.canceled?" Batch stopped at your cancellation.":""}`);}catch{notice("The batch could not finish. Check browser Downloads for files already started.");}finally{busy=false;updateSelection();}
  };
  $("export").onclick=async()=>{const result=await send({type:"export-list",items:visibleItems()});notice(result.error||(result.id===null?"Export canceled.":"Media list sent to browser Downloads."));};
  let zipController;
  $("cancel-zip").onclick=()=>zipController?.abort();
  $("save-zip").onclick=async()=>{
    const items=data.items.filter(i=>selected.has(id(i)));if(!items.length||items.length>100){notice("Select 1–100 files for a ZIP.");return;}
    busy=true;updateSelection();zipController=new AbortController();$("cancel-zip").hidden=false;
    let owned="";
    try{
      await RightSaveCommerce.requirePro();const zip=new RightSavePro.Zip();
      for(const [index,item] of items.entries()){
        if(zipController.signal.aborted)throw new DOMException("Canceled","AbortError");
        $("archive-status").textContent=`Preparing ${index+1} / ${items.length}…`;
        const source=await send({type:"archive-source",item});if(source.error)throw new Error(source.error);
        const timer=setTimeout(()=>zipController.abort(),30000);
        let bytes;try{bytes=await RightSavePro.fetchFile(source.url,zipController.signal);}finally{clearTimeout(timer);}
        const name=$("template").value.trim()?U.templatedFilename(item,$("template").value.trim(),index+1):source.filename;
        zip.add(name,bytes);
      }
      owned=URL.createObjectURL(zip.blob());const result=await send({type:"save-archive",url:owned});if(result.error)throw new Error(result.error);
      if(result.id===null){$("archive-status").textContent="ZIP save canceled.";URL.revokeObjectURL(owned);owned="";}
      else{
        $("archive-status").textContent=`${items.length} files packaged. Check browser Downloads.`;
        const url=owned;owned="";const release=delta=>{if(delta.id===result.id&&["complete","interrupted"].includes(delta.state?.current)){URL.revokeObjectURL(url);browser.downloads.onChanged.removeListener(release);}};
        browser.downloads.onChanged.addListener(release);const [download]=await browser.downloads.search({id:result.id});if(download&&download.state!=="in_progress")release({id:result.id,state:{current:download.state}});
      }
    }catch(error){$("archive-status").textContent=error.name==="AbortError"?"ZIP preparation canceled or timed out. No partial archive was saved.":error.message;}
    finally{if(owned)URL.revokeObjectURL(owned);busy=false;zipController=null;$("cancel-zip").hidden=true;updateSelection();}
  };
  async function refreshPresets(){if(!plan.pro)return;const values=await RightSavePro.presets();$("preset").replaceChildren(new Option("Choose a workflow",""),...values.map(p=>new Option(p.name,p.name)));}
  $("save-preset").onclick=async()=>{try{const p=await RightSavePro.savePreset({name:$("preset-name").value,template:$("template").value,search:$("search").value,minWidth:$("min-width").value,filter,sort:$("sort").value,size});await refreshPresets();$("preset").value=p.name;notice("Workflow saved on this browser.");}catch(error){notice(error.message);}};
  $("apply-preset").onclick=async()=>{try{const p=(await RightSavePro.presets()).find(p=>p.name===$("preset").value);if(!p)throw new Error("Choose a saved workflow.");filter=p.filter;size=p.size;$("search").value=p.search;$("min-width").value=p.minWidth;$("sort").value=p.sort;$("template").value=p.template;$("preset-name").value=p.name;document.querySelectorAll("[data-filter]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.filter===filter)));render();notice("Workflow applied.");}catch(error){notice(error.message);}};
  $("delete-preset").onclick=async()=>{try{await RightSavePro.removePreset($("preset").value);await refreshPresets();notice("Workflow removed.");}catch(error){notice(error.message);}};
  await refreshPresets();
  $("close-zoom").onclick=()=>$("zoom").close();$("zoom").onclick=event=>{if(event.target===$("zoom"))$("zoom").close();};
  render();
})().catch(error=>{const n=document.getElementById("notice");n.hidden=false;n.textContent=error.message;});
