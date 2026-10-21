(async () => {
  const $ = id => document.getElementById(id);
  const [tab] = await browser.tabs.query({active: true, currentWindow: true});
  const settings = await browser.storage.local.get({disabledSites: [], quickSave: true});
  const {theme="dark"}=await browser.storage.local.get("theme");document.documentElement.dataset.theme=theme;
  const host = (() => { try { return new URL(tab.url).hostname; } catch { return ""; } })();
  const available = /^(https?|file):/.test(tab.url || "");
  $("host").textContent = available ? (host || "Local file") : "Open a regular webpage to use RightSave";
  $("restore").checked = !settings.disabledSites.includes(host);
  $("restore").disabled = !host || !available;
  $("quick").checked = settings.quickSave;
  $("restore").addEventListener("change", async () => {
    const {disabledSites = []} = await browser.storage.local.get("disabledSites");
    const sites = new Set(disabledSites);
    if ($("restore").checked) sites.delete(host); else sites.add(host);
    await browser.storage.local.set({disabledSites: [...sites]});
    $("status").textContent = $("restore").checked ? "Right-click restoration enabled." : "The website can use its own right-click menu.";
  });
  $("quick").addEventListener("change", () => browser.storage.local.set({quickSave: $("quick").checked}));
  $("browse").addEventListener("click", async () => {
    $("browse").disabled = true;
    $("status").textContent = "Looking for media…";
    try {
      const result = await browser.runtime.sendMessage({type: "browse", tabId: tab.id});
      if (result.error) $("status").textContent = result.error; else window.close();
    } catch { $("status").textContent = "RightSave could not scan this page. Refresh the webpage and try again."; }
    $("browse").disabled = false;
  });
})().catch(error => { document.getElementById("status").textContent = error.message; });
