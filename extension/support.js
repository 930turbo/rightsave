(async()=>{
  const $=id=>document.getElementById(id),{theme="dark"}=await browser.storage.local.get("theme");document.documentElement.dataset.theme=theme;
  let plan=await RightSaveCommerce.status();
  function render(){
    const configured=!!(plan.config.lemon||plan.config.publicKey);
    $("paid-tools").hidden=!configured;$("license-tools").hidden=!configured;
    $("status").textContent=plan.error||(plan.pro?`Plus is active on this browser. Reopen the library to use its tools.${plan.offline?" Offline access; reconnect within seven days of your last check.":""}`:"RightSave Free. Individual saves are unlimited.");
    $("activate").disabled=!configured;$("refresh-license").disabled=!plan.config.lemon||!plan.hasPurchase;$("remove-license").disabled=!plan.hasPurchase&&!plan.pro;
    if(plan.config.lemon){
      const config=plan.config.lemon,tier=config.products.plus?"plus":config.products.pro?"pro":"studio";
      $("checkout").href=RightSavePayments.checkout(config,tier);$("checkout").hidden=plan.pro;$("checkout").textContent=config.testMode?"Test Plus checkout":"Get Plus";
      $("checkout-pending").hidden=!plan.pro;$("checkout-pending").textContent="Active on this browser.";
      $("price").textContent=config.displayPrice||"See the final price at checkout.";$("orders").hidden=false;
      $("sales-note").textContent=config.testMode?"Test mode. Use the provider’s test card; this build is for checkout testing.":"One-time purchase. No automatic renewal. Release this browser’s activation before moving to another profile. Licenses normally check once a day, with seven days offline after a successful check.";
    }else if(plan.config.publicKey)$("license-help").textContent="Paste your signed offline license. It is checked on this device.";
  }
  async function action(name){
    for(const id of ["activate","refresh-license","remove-license"])$(id).disabled=true;
    $("status").textContent="Checking license…";
    try{const result=await browser.runtime.sendMessage({type:"commerce",action:name,key:$("license").value});if(result.error){render();$("status").textContent=result.error;return;}plan=result;$("license").value="";render();if(name==="deactivate")$("status").textContent="Browser deactivated. Its activation is available to use elsewhere.";}
    catch{render();$("status").textContent="The license could not be checked. Try again.";}
  }
  $("activate").onclick=()=>action("activate");$("refresh-license").onclick=()=>action("refresh");$("remove-license").onclick=()=>action("deactivate");render();
})().catch(error=>{document.getElementById("status").textContent=error.message;});
