/* Gallery operations are local and never rewrite signed media URLs. */
globalThis.RightSaveGallery = (() => {
  function format(item) {
    if(item.url?.startsWith("canvas:"))return "png";
    if(item.url?.startsWith("svg:"))return "svg";
    const mime=(item.mime||"").split(";")[0].split("/")[1];
    const suffix=String(item.url||"").split(/[?#]/)[0].match(/\.([a-z0-9]{2,5})$/i)?.[1];
    let value=(mime||suffix||"").toLowerCase();
    if(!value)try{value=new URL(item.url).searchParams.get("format")||"";}catch{}
    return value==="jpeg"?"jpg":value==="svg+xml"?"svg":value;
  }
  function filter(items,options={}) {
    const query=String(options.query||"").trim().toLowerCase();
    let values=items.filter(item=>{
      if(options.kind&&options.kind!=="all"&&item.kind!==options.kind)return false;
      if(options.minWidth&&(item.width||0)<options.minWidth)return false;
      if(options.format&&options.format!=="all"&&format(item)!==options.format)return false;
      const w=Number(item.width),h=Number(item.height);
      if(options.orientation&&options.orientation!=="all"){
        if(!(w>0&&h>0))return false;
        if(options.orientation==="landscape"&&w<=h)return false;
        if(options.orientation==="portrait"&&h<=w)return false;
        if(options.orientation==="square"&&w!==h)return false;
      }
      if(query&&![item.label,item.source,item.url].join(" ").toLowerCase().includes(query))return false;
      return true;
    });
    if(options.unique){
      const grouped=new Map();
      for(const item of values){let key=item.kind+":"+item.url;
        try{const u=new URL(item.url);if(u.hostname==="pbs.twimg.com"&&u.pathname.startsWith("/media/")&&[...u.searchParams.keys()].every(k=>["format","name"].includes(k))){key="x:"+u.pathname.replace(/:(small|medium|large|orig)$/i,"")+":"+(u.searchParams.get("format")||format(item));}}catch{}
        const previous=grouped.get(key);if(!previous||(item.width||0)*(item.height||0)>(previous.width||0)*(previous.height||0))grouped.set(key,item);
      }
      values=[...grouped.values()];
    }
    if(options.sort==="largest")values.sort((a,b)=>(b.width||0)*(b.height||0)-(a.width||0)*(a.height||0));
    if(options.sort==="name")values.sort((a,b)=>RightSaveUtil.filename(a).localeCompare(RightSaveUtil.filename(b)));
    return values;
  }
  async function digest(bytes){return [...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))].map(v=>v.toString(16).padStart(2,"0")).join("");}
  return {format,filter,digest};
})();
