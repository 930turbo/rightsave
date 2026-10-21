(async()=>{
  const $=id=>document.getElementById(id);
  const {theme="dark"}=await browser.storage.local.get("theme");document.documentElement.dataset.theme=theme;
  let plan=await RightSaveCommerce.status();
  function render(){
    const name=plan.plan==="studio"?"Studio":plan.plan==="pro"?"Pro":plan.plan==="supporter"?"Supporter":"Free";
    $("status").textContent=plan.error||(plan.pro?`${name} is active on this browser. Reopen the library to use its tools.${plan.offline?" Offline access; reconnect within seven days of your last check.":""}`:"You’re using Free. Individual saves are unlimited.");
    const paid=!!plan.config.lemon;
    $("activate").disabled=!paid&&!plan.config.publicKey;
    $("refresh-license").disabled=!paid||!plan.hasPurchase;
    $("remove-license").disabled=!plan.hasPurchase&&!plan.pro&&plan.plan!=="supporter";
    if(paid){
      for(const [tier,id,pending] of [["pro","checkout","checkout-pending"],["studio","checkout-studio","studio-pending"]]){
        $(id).href=RightSavePayments.checkout(plan.config.lemon,tier);$(id).hidden=false;$(pending).hidden=true;
        $(id).textContent=plan.config.lemon.testMode?`Test ${tier==="pro"?"Pro":"Studio"} checkout`:`Get ${tier==="pro"?"Pro":"Studio"}`;
        if((tier==="pro"&&plan.pro)||(tier==="studio"&&plan.studio)){$(id).hidden=true;$(pending).hidden=false;$(pending).textContent="Active on this browser.";}
      }
      $("orders").hidden=false;
      $("license-help").textContent="Activating sends your license key and a random browser label to Lemon Squeezy. Browsing history and saved media are not sent.";
      $("sales-note").textContent=plan.config.lemon.testMode?"Test checkout is enabled. Use the provider’s test card details; no real payments should be made in this build.":"One-time purchases, with no automatic renewal. The price and any applicable tax shown at checkout are final.";
    }else if(plan.config.publicKey)$("license-help").textContent="Paste your signed offline license. It is verified on this browser.";
  }
  async function action(name){
    for(const id of ["activate","refresh-license","remove-license"])$(id).disabled=true;
    $("status").textContent="Checking license…";
    try{
      const result=await browser.runtime.sendMessage({type:"commerce",action:name,key:$("license").value});
      if(result.error){render();$("status").textContent=result.error;return;}
      plan=result;$("license").value="";render();
      if(name==="deactivate")$("status").textContent="Browser deactivated. Its paid activation is available to use elsewhere.";
    }catch{render();$("status").textContent="The license could not be checked. Try again.";}
  }
  $("activate").onclick=()=>action("activate");$("refresh-license").onclick=()=>action("refresh");$("remove-license").onclick=()=>action("deactivate");
  render();
})().catch(error=>{document.getElementById("status").textContent=error.message;});
