/* Hosted checkout and Lemon Squeezy's public License API. No merchant secrets. */
globalThis.RightSavePayments = (() => {
  const DAY = 86400000, GRACE = 7 * DAY;
  let pending, memory, retryAt = 0;
  const api = "https://api.lemonsqueezy.com/v1/licenses/";
  function product(config, plan) {
    const p = config?.products?.[plan];
    if (!["plus", "pro", "studio"].includes(plan) || !p) throw new Error("This upgrade is not available yet.");
    return p;
  }
  function checkout(config, plan) {
    const url = new URL(product(config, plan).checkoutURL);
    if (url.protocol !== "https:" || !/^[a-z0-9-]+\.lemonsqueezy\.com$/.test(url.hostname) || url.username || url.password || url.port || !/^\/checkout\/buy\/[^/]+$/.test(url.pathname)) throw new Error("Invalid checkout destination.");
    return url.href;
  }
  async function request(action, values) {
    let response;
    try {
      response = await fetch(api + action, {method:"POST", headers:{Accept:"application/json", "Content-Type":"application/x-www-form-urlencoded"}, body:new URLSearchParams(values).toString(), credentials:"omit", referrerPolicy:"no-referrer", redirect:"error", signal:AbortSignal.timeout(10000)});
      if (response.status === 429 || response.status >= 500) throw new Error("License service is temporarily unavailable.");
      const data = await response.json();
      if (!response.ok && response.status >= 400 && response.status < 500) return {...data, valid:false, activated:false};
      if (!response.ok) throw new Error("License service is temporarily unavailable.");
      return data;
    } catch (error) { throw new Error("Could not reach the license service. Check your connection and try again.", {cause:error}); }
  }
  function entitlement(config, data, key, instance) {
    const meta = data.meta, license = data.license_key;
    const pair = Object.entries(config.products).find(([plan, p]) => ["plus","pro","studio"].includes(plan) && Number(p.productId) === meta?.product_id && Number(p.variantId) === meta?.variant_id);
    if (!pair || meta?.store_id !== Number(config.storeId) || license?.key !== key || license.status !== "active" || !data.instance?.id || (instance && data.instance.id !== instance)) throw new Error("This license is inactive or belongs to another product.");
    const expires = license.expires_at ? Date.parse(license.expires_at) : null;
    if (expires !== null && (!Number.isFinite(expires) || expires <= Date.now())) throw new Error("This license has expired.");
    return {product:"rightsave", id:String(license.id), plan:pair[0], expires, provider:"lemonsqueezy"};
  }
  const identity = config => JSON.stringify([config.storeId,Object.entries(config.products).filter(([p])=>["plus","pro","studio"].includes(p)).map(([p,v])=>[p,v.productId,v.variantId]),config.testMode]);
  async function write(record) { await browser.storage.local.set({purchaseLicense:record}); memory=record; }
  async function clear() { memory=null; await browser.storage.local.remove("purchaseLicense"); }
  async function validate(config, record) {
    const data = await request("validate", {license_key:record.key, instance_id:record.instance});
    try {
      if (data.valid !== true) throw new Error("License is no longer valid. Free saving is still available.");
      const claims = entitlement(config, data, record.key, record.instance);
      const updated = {...record, claims, checked:Date.now()};
      await write(updated); retryAt=0; return {claims, offline:false, checked:updated.checked};
    } catch (error) { await clear(); throw error; }
  }
  async function status(config, force=false) {
    if (!config) return null;
    if (pending) return pending;
    pending = (async()=>{
      const record = (await browser.storage.local.get("purchaseLicense")).purchaseLicense;
      if (!record || record.identity !== identity(config)) return null;
      if(record.claims?.expires && record.claims.expires<=Date.now()){await clear();return {error:"This license has expired. Free saving is still available."};}
      const age = Date.now() - record.checked;
      if (!force && retryAt > Date.now()) return age >= 0 && age < GRACE && (!record.claims.expires || record.claims.expires > Date.now()) ? {claims:record.claims, checked:record.checked, offline:true} : null;
      if (!force && memory?.key === record.key && age >= 0 && age < DAY) return {claims:memory.claims, checked:memory.checked, offline:false};
      try { return await validate(config, record); }
      catch (error) {
        // Invalid responses clear storage; only a transport outage gets grace.
        const current = (await browser.storage.local.get("purchaseLicense")).purchaseLicense;
        if (!current) return {error:error.message};
        retryAt=Date.now()+3600000;
        if (age >= 0 && age < GRACE && ["plus","pro","studio"].includes(record.claims?.plan) && (!record.claims.expires || record.claims.expires > Date.now())) return {claims:record.claims, checked:record.checked, offline:true};
        return {error:"Reconnect to check your license. Free saving is still available."};
      }
    })();
    try { return await pending; } finally { pending=null; }
  }
  async function activate(config, input) {
    if (!config) throw new Error("Paid licenses are not available in this free local build.");
    const key = input.trim();
    if (!/^[a-zA-Z0-9-]{8,120}$/.test(key)) throw new Error("Enter the license key from your purchase email.");
    const previous = (await browser.storage.local.get("purchaseLicense")).purchaseLicense;
    if (previous) {
      if (previous.key !== key) throw new Error("Deactivate this browser before using a different license.");
      const result = await status(config,true); if (!result?.claims) throw new Error(result?.error || "License could not be checked."); return result.claims;
    }
    // Validate ownership before consuming an activation for an unrelated product.
    const preflight=await request("validate",{license_key:key});
    const meta=preflight.meta;
    if (preflight.valid !== true || meta?.store_id !== Number(config.storeId) || !Object.entries(config.products).some(([plan,p])=>["plus","pro","studio"].includes(plan)&&Number(p.productId)===meta?.product_id&&Number(p.variantId)===meta?.variant_id)) throw new Error("This key is not a valid RightSave license.");
    const data=await request("activate",{license_key:key,instance_name:"RightSave "+crypto.randomUUID().slice(0,8)});
    if (data.activated !== true) throw new Error("Could not activate this browser. Check the key or free an activation in your other browser.");
    let claims;
    try { claims=entitlement(config,data,key); }
    catch (error) { if(data.instance?.id) await request("deactivate",{license_key:key,instance_id:data.instance.id}).catch(()=>{}); throw error; }
    await write({key,instance:data.instance.id,identity:identity(config),claims,checked:Date.now()});retryAt=0;return claims;
  }
  async function deactivate() {
    const record=(await browser.storage.local.get("purchaseLicense")).purchaseLicense;
    if (!record) return;
    const data=await request("deactivate",{license_key:record.key,instance_id:record.instance});
    if(data.deactivated !== true) throw new Error("The activation could not be released. Try again while online.");
    await clear(); retryAt=0;
  }
  let queue=Promise.resolve();
  function serial(action){const result=queue.then(action,action);queue=result.catch(()=>{});return result;}
  return {checkout,status:(...args)=>serial(()=>status(...args)),activate:(...args)=>serial(()=>activate(...args)),deactivate:()=>serial(deactivate),DAY,GRACE};
})();
