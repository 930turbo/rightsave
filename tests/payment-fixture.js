// Deterministic provider stand-in, copied only into disposable integration builds.
(()=>{
  const realFetch=globalThis.fetch;
  globalThis.fetch=async(url,options)=>{
    if(!String(url).startsWith("https://api.lemonsqueezy.com/v1/licenses/"))return realFetch(url,options);
    const {mockMode="ok",mockCalls=[]}=await browser.storage.local.get(["mockMode","mockCalls"]);
    const action=String(url).split("/").at(-1),body=new URLSearchParams(options.body);
    await browser.storage.local.set({mockCalls:[...mockCalls,{action,instance:body.get("instance_id"),label:body.get("instance_name"),method:options.method,credentials:options.credentials}]});
    if(mockMode==="offline")throw new TypeError("Test network outage");
    const valid=mockMode!=="disabled",key=body.get("license_key");
    return new Response(JSON.stringify({valid,activated:valid,deactivated:true,license_key:{id:12,key,status:valid?"active":"disabled",expires_at:null},instance:action==="validate"&&!body.has("instance_id")?null:{id:"test-browser-instance"},meta:{store_id:7,product_id:8,variant_id:10,customer_email:"never-store@example.test"}}),{status:200,headers:{"Content-Type":"application/json"}});
  };
})();
