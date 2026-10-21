(async()=>{
  const $=id=>document.getElementById(id),plan=await RightSaveCommerce.status(),{theme="dark"}=await browser.storage.local.get("theme");document.documentElement.dataset.theme=theme;
  $("status").textContent=plan.plan==="free"?"Core saving is free. No active license on this browser.":`${plan.plan==="pro"?"Pro":"Supporter"} license active on this browser.`;
  function configureLink(id,url,pending){try{const value=new URL(url);if(value.protocol!=="https:")return;$(id).href=value.href;$(id).hidden=false;$(pending).hidden=true;}catch{}}
  configureLink("checkout",plan.config.checkoutURL,"checkout-pending");configureLink("donate",plan.config.supportURL,"support-pending");
  $("activate").disabled=!plan.config.publicKey;
  if(!plan.config.publicKey)$("activate").title="License activation is not available in this release yet.";
  $("activate").onclick=async()=>{try{const claims=await RightSaveCommerce.activate($("license").value);$("license").value="";$("status").textContent=`${claims.plan==="pro"?"Pro":"Supporter"} license activated. Open a new library page to use it.`;}catch(error){$("status").textContent=error.message;}};
  $("remove-license").onclick=async()=>{await browser.storage.local.remove("license");$("status").textContent="Local license removed. Free core saving remains available.";};
})().catch(error=>{document.getElementById("status").textContent=error.message;});
