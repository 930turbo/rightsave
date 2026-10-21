/* Local Pro workflows. No network service, telemetry, or payment SDK. */
globalThis.RightSavePro = (() => {
  const MAX_BYTES = 150 * 1024 * 1024, MAX_FILE = 40 * 1024 * 1024;
  const table = Uint32Array.from({length:256},(_,i)=>{
    let c=i;for(let bit=0;bit<8;bit++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;
  });
  function crc32(bytes) { let c=0xffffffff;for(const b of bytes)c=table[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0; }
  function safePath(value) {
    if(typeof value!=="string"||value.length>600||/^[\\/]|^[a-z]:|[\\\u0000-\u001f]/i.test(value))throw new Error("Invalid archive filename.");
    const parts=value.split("/");
    if(parts.some(p=>!p.trim()||/^\.+$/.test(p)))throw new Error("Invalid archive folder.");
    return value;
  }
  class Zip {
    constructor(){this.files=[];this.names=new Set();this.bytes=0;}
    add(name,bytes){
      if(!(bytes instanceof Uint8Array))throw new Error("Archive data must be bytes.");
      if(this.files.length>=100||bytes.length>MAX_FILE||this.bytes+bytes.length>MAX_BYTES)throw new Error("ZIP limit: 100 files, 40 MB per file, 150 MB total. Use a smaller selection.");
      name=safePath(name);const original=name;let n=1;
      while(this.names.has(name)){const dot=original.lastIndexOf(".");name=dot>original.lastIndexOf("/")?original.slice(0,dot)+` (${++n})`+original.slice(dot):original+` (${++n})`;}
      this.names.add(name);this.files.push({name,bytes,crc:crc32(bytes)});this.bytes+=bytes.length;return name;
    }
    blob(){
      if(!this.files.length)throw new Error("Select files to archive.");
      const chunks=[],central=[];let offset=0,centralSize=0;
      const now=new Date(),year=Math.max(1980,Math.min(2107,now.getFullYear()));
      const time=(now.getHours()<<11)|(now.getMinutes()<<5)|(now.getSeconds()>>1),date=((year-1980)<<9)|((now.getMonth()+1)<<5)|now.getDate();
      for(const file of this.files){
        const name=new TextEncoder().encode(file.name),local=new Uint8Array(30+name.length),v=new DataView(local.buffer);
        v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint16(10,time,true);v.setUint16(12,date,true);v.setUint32(14,file.crc,true);v.setUint32(18,file.bytes.length,true);v.setUint32(22,file.bytes.length,true);v.setUint16(26,name.length,true);local.set(name,30);
        const header=new Uint8Array(46+name.length),h=new DataView(header.buffer);
        h.setUint32(0,0x02014b50,true);h.setUint16(4,20,true);h.setUint16(6,20,true);h.setUint16(8,0x800,true);h.setUint16(12,time,true);h.setUint16(14,date,true);h.setUint32(16,file.crc,true);h.setUint32(20,file.bytes.length,true);h.setUint32(24,file.bytes.length,true);h.setUint16(28,name.length,true);h.setUint32(42,offset,true);header.set(name,46);
        chunks.push(local,file.bytes);central.push(header);offset+=local.length+file.bytes.length;centralSize+=header.length;
      }
      const end=new Uint8Array(22),e=new DataView(end.buffer);e.setUint32(0,0x06054b50,true);e.setUint16(8,this.files.length,true);e.setUint16(10,this.files.length,true);e.setUint32(12,centralSize,true);e.setUint32(16,offset,true);
      return new Blob([...chunks,...central,end],{type:"application/zip"});
    }
  }
  function preset(value){
    if(!value||typeof value.name!=="string"||!value.name.trim()||value.name.length>40)throw new Error("Name the workflow using 1–40 characters.");
    if(typeof value.template!=="string"||value.template.length>160||typeof value.search!=="string"||value.search.length>200)throw new Error("The workflow contains invalid text.");
    const minWidth=Number(value.minWidth);
    if(!Number.isInteger(minWidth)||minWidth<0||minWidth>20000)throw new Error("Minimum width must be 0–20,000 pixels.");
    if(!["all","image","video"].includes(value.filter)||!["page","largest","name"].includes(value.sort)||!["large","xl"].includes(value.size))throw new Error("Invalid workflow options.");
    const format=value.format??"all",orientation=value.orientation??"all",unique=value.unique??false;
    if(!["all","jpg","png","webp","avif","gif","svg","mp4","webm"].includes(format)||!["all","landscape","portrait","square"].includes(orientation)||typeof unique!=="boolean")throw new Error("Invalid workflow filters.");
    return {name:value.name.trim(),template:value.template,search:value.search,minWidth,filter:value.filter,sort:value.sort,size:value.size,format,orientation,unique};
  }
  async function presets(){
    await RightSaveCommerce.requirePro();
    const {workflowPresets=[]}=await browser.storage.local.get("workflowPresets");
    return workflowPresets.slice(0,20).flatMap(p=>{try{return[preset(p)];}catch{return[];}});
  }
  async function savePreset(value){
    const p=preset(value),values=await presets(),index=values.findIndex(v=>v.name===p.name);
    if(index<0&&values.length>=20)throw new Error("Keep up to 20 workflows. Remove one before adding another.");
    if(index<0)values.push(p);else values[index]=p;
    await browser.storage.local.set({workflowPresets:values});return p;
  }
  async function removePreset(name){await browser.storage.local.set({workflowPresets:(await presets()).filter(p=>p.name!==name)});}
  async function fetchFile(url,signal){
    const response=await fetch(url,{credentials:"include",signal});
    if(!response.ok)throw new Error(`The media host returned ${response.status}. Open the post and rescan.`);
    const mime=response.headers.get("content-type")||"";
    if(/(?:text\/html|application\/json)/i.test(mime))throw new Error("The host returned a webpage or login response instead of media.");
    if(Number(response.headers.get("content-length")||0)>MAX_FILE)throw new Error("A selected file exceeds the ZIP limit of 40 MB.");
    const reader=response.body?.getReader();if(!reader)throw new Error("The media host returned an empty response.");
    const chunks=[];let count=0;
    try{while(true){const {done,value}=await reader.read();if(done)break;count+=value.length;if(count>MAX_FILE)throw new Error("A selected file exceeds the ZIP limit of 40 MB.");chunks.push(value);}}
    catch(error){void reader.cancel().catch(()=>{});throw error;}
    if(!count)throw new Error("The media host returned an empty file.");
    const bytes=new Uint8Array(count);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
  }
  async function exportPack(){
    await RightSaveCommerce.requireStudio();
    return JSON.stringify({product:"rightsave",version:1,workflows:await presets()},null,2);
  }
  async function importPack(text){
    await RightSaveCommerce.requireStudio();
    if(typeof text!=="string"||text.length>50000)throw new Error("Choose a RightSave workflow pack under 50 KB.");
    const pack=JSON.parse(text);
    if(pack.product!=="rightsave"||pack.version!==1||!Array.isArray(pack.workflows)||pack.workflows.length>20)throw new Error("This is not a supported RightSave workflow pack.");
    const incoming=pack.workflows.map(preset),merged=new Map((await presets()).map(p=>[p.name,p]));
    for(const p of incoming)merged.set(p.name,p);
    if(merged.size>20)throw new Error("The pack would exceed 20 workflows. Remove some and try again.");
    await browser.storage.local.set({workflowPresets:[...merged.values()]});return incoming.length;
  }
  function publicURL(value){try{const u=new URL(value);if(!["http:","https:"].includes(u.protocol))return "";u.search="";u.hash="";u.username="";u.password="";return u.href.slice(0,2000);}catch{return "";}}
  function sourceRecords(rows){
    if(!Array.isArray(rows)||rows.length>98)throw new Error("Use up to 98 media files when including source records.");
    const records=rows.map(r=>({filename:String(r.filename).slice(0,600),label:String(r.item.label||"").slice(0,300),page:publicURL(r.item.pageURL),media:publicURL(r.item.url),width:Number(r.item.width)||0,height:Number(r.item.height)||0,bytes:r.bytes}));
    const cell=value=>{let text=String(value??"");if(/^[\s]*[=+@-]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};
    const columns=["filename","label","page","media","width","height","bytes"];
    return {json:JSON.stringify({created:new Date().toISOString(),notice:"URLs omit query strings. Source records do not grant reuse rights.",files:records},null,2),csv:[columns,...records.map(r=>columns.map(c=>r[c]))].map(row=>row.map(cell).join(",")).join("\r\n")+"\r\n"};
  }
  async function convert(url,type,maxEdge=0){
    await RightSaveCommerce.requirePro();
    if(!["image/png","image/jpeg","image/webp"].includes(type)||!Number.isInteger(maxEdge)||maxEdge<0||maxEdge>8192)throw new Error("Choose PNG, JPEG or WebP and a valid maximum size.");
    const bytes=await fetchFile(url,AbortSignal.timeout(30000));
    const image=await createImageBitmap(new Blob([bytes]));
    try{
      if(image.width*image.height>16000000)throw new Error("This image is too large to convert here. Save the original instead (16 megapixel conversion limit).");
      const ratio=maxEdge?Math.min(1,maxEdge/Math.max(image.width,image.height)):1;
      const width=Math.max(1,Math.round(image.width*ratio)),height=Math.max(1,Math.round(image.height*ratio));
      const canvas=new OffscreenCanvas(width,height),context=canvas.getContext("2d");
      if(type==="image/jpeg"){context.fillStyle="#ffffff";context.fillRect(0,0,width,height);}
      context.drawImage(image,0,0,width,height);
      const blob=await canvas.convertToBlob({type,quality:.92});
      if(blob.type!==type)throw new Error("This browser cannot export the selected format. Try PNG.");
      return {blob,width,height};
    }finally{image.close();}
  }
  return {Zip,crc32,preset,presets,savePreset,removePreset,fetchFile,exportPack,importPack,sourceRecords,convert,MAX_BYTES,MAX_FILE};
})();
