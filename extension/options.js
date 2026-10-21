(async () => {
  const $ = (id) => document.getElementById(id),
    settings = await browser.storage.local.get({
      quickSave: true,
      thumbnailSize: "large",
      theme: "dark",
      disabledSites: [],
      enhancedDetection: true,
    });
  function status(text) {
    $("status").textContent = text;
    $("status").hidden = false;
  }
  $("quick").checked = settings.quickSave;
  $("size").value = settings.thumbnailSize;
  $("theme").value = settings.theme;
  $("sites").value = settings.disabledSites.join("\n");
  document.documentElement.dataset.theme = settings.theme;
  $("network").checked = await browser.permissions.contains({
    permissions: ["webRequest"],
  });
  $("social").checked = settings.enhancedDetection;
  $("social").onchange = async () => {
    await browser.storage.local.set({ enhancedDetection: $("social").checked });
    status(
      $("social").checked
        ? "Enhanced detection enabled. Open or play the post, then rescan."
        : "Enhanced detection disabled. Page media caches cleared; ordinary media scanning stays available.",
    );
  };
  $("quick").onchange = async () => {
    await browser.storage.local.set({ quickSave: $("quick").checked });
    status("Right-click behavior saved.");
  };
  $("size").onchange = async () => {
    await browser.storage.local.set({ thumbnailSize: $("size").value });
    status("Thumbnail size saved. New library pages use this size.");
  };
  $("theme").onchange = async () => {
    document.documentElement.dataset.theme = $("theme").value;
    await browser.storage.local.set({ theme: $("theme").value });
    status("Appearance saved.");
  };
  $("network").onchange = async () => {
    try {
      if ($("network").checked) {
        const granted = await browser.permissions.request({
          permissions: ["webRequest"],
        });
        $("network").checked = granted;
        status(
          granted
            ? "Video-request detection enabled. Play the video, then rescan."
            : "Permission was not granted. Page-based media detection still works.",
        );
      } else {
        await browser.permissions.remove({ permissions: ["webRequest"] });
        status(
          "Video-request detection disabled and its session list cleared.",
        );
      }
    } catch (error) {
      $("network").checked = false;
      status(error.message);
    }
  };
  $("clear-lists").onclick = async () => {
    const result = await browser.runtime.sendMessage({ type: "clear-lists" });
    if (!result?.ok) {
      status("The lists could not be cleared. Reopen Settings and try again.");
      return;
    }
    status(
      "Temporary lists cleared. Close existing library pages and reopen RightSave to scan again. Downloaded files and workflows were kept.",
    );
  };
  $("save-sites").onclick = async () => {
    const sites = [
      ...new Set(
        $("sites")
          .value.split(/\s+/)
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean),
      ),
    ];
    if (sites.some((s) => !/^([a-z0-9-]+\.)*[a-z0-9-]+$/.test(s))) {
      status(
        "Enter hostnames such as example.com, without https:// or a path.",
      );
      return;
    }
    await browser.storage.local.set({ disabledSites: sites });
    status("Site exceptions saved.");
  };
})().catch((error) => {
  const s = document.getElementById("status");
  s.hidden = false;
  s.textContent = error.message;
});
