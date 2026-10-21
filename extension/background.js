const U = globalThis.RightSaveUtil;
const MENU = {
  root: "rightsave",
  image: "save-image",
  video: "save-video",
  here: "media-here",
  page: "media-page",
};
let generation = 0;
const pendingSaves = new Map();
const canceled = (error) =>
  /USER_CANCELED|cancell?ed by the user|user cancell?ed|download cancell?ed/i.test(
    String(error?.message || error),
  );

async function createMenus() {
  await browser.menus.removeAll();
  browser.menus.create({
    id: MENU.root,
    title: "RightSave",
    contexts: ["all"],
    documentUrlPatterns: ["http://*/*", "https://*/*", "file:///*"],
  });
  for (const [id, title] of [
    [MENU.image, "Save detected image…"],
    [MENU.video, "Save detected video…"],
    [MENU.here, "Choose media at this spot…"],
    [MENU.page, "Find images and videos on this page…"],
  ]) {
    browser.menus.create({ id, parentId: MENU.root, title, contexts: ["all"] });
  }
}
browser.runtime.onInstalled.addListener(async (details) => {
  await createMenus();
  await browser.storage.local.remove(["license", "purchaseLicense"]);
  if (details.reason === "install")
    await browser.tabs.create({ url: browser.runtime.getURL("welcome.html") });
});

async function contextItems(info, tab) {
  let items = [];
  try {
    items = await browser.tabs.sendMessage(
      tab.id,
      { type: "context", targetElementId: info.targetElementId },
      { frameId: info.frameId ?? 0 },
    );
  } catch {
    /* A restricted page or a page opened before installation. */
  }
  items = (items || []).map((item) => ({
    ...item,
    frameId: info.frameId ?? 0,
  }));
  if (
    info.srcUrl &&
    ["image", "video"].includes(info.mediaType) &&
    !items.some(
      (item) => item.url === info.srcUrl && item.kind === info.mediaType,
    )
  ) {
    items.unshift({
      url: info.srcUrl,
      kind: info.mediaType,
      source: "Browser media",
      pageURL: info.frameUrl || info.pageUrl,
      frameId: info.frameId ?? 0,
    });
  }
  return items;
}
browser.menus.onShown?.addListener(async (info, tab) => {
  if (!tab?.id || !info.menuIds.includes(MENU.root)) return;
  const current = ++generation;
  const items = await contextItems(info, tab);
  if (current !== generation) return;
  await Promise.all([
    browser.menus.update(MENU.image, {
      enabled: items.some((i) => i.kind === "image"),
    }),
    browser.menus.update(MENU.video, {
      enabled: items.some((i) => i.kind === "video" && !U.issue(i)),
    }),
    browser.menus.update(MENU.here, { enabled: items.length > 0 }),
  ]);
  if (current === generation) browser.menus.refresh();
});
browser.menus.onHidden?.addListener(() => {
  generation++;
});

async function openPicker(
  tab,
  items,
  notice = "",
  title = "Media at this spot",
) {
  const id = crypto.randomUUID();
  const stored = await browser.storage.session.get(null);
  const stale = Object.keys(stored).filter(
    (key) =>
      /^(picker:|download:)/.test(key) &&
      Date.now() - stored[key].created > 2 * 60 * 60 * 1000,
  );
  if (stale.length) await browser.storage.session.remove(stale);
  await browser.storage.session.set({
    ["picker:" + id]: {
      tabId: tab.id,
      pageURL: tab.url,
      pageTitle: tab.title || "Webpage",
      title,
      items,
      notice,
      created: Date.now(),
    },
  });
  const library = await browser.tabs.create({
    url: browser.runtime.getURL("library.html") + "?session=" + id,
    windowId: tab.windowId,
  });
  const key = "picker:" + id,
    record = (await browser.storage.session.get(key))[key];
  if (record)
    await browser.storage.session.set({
      [key]: { ...record, libraryTabId: library.id },
    });
}
async function scan(tabId) {
  const results = await browser.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: () => globalThis.__rightSave?.collect() || null,
  });
  const seen = new Set();
  const observed =
    (await browser.storage.session.get("network:" + tabId))[
      "network:" + tabId
    ] || [];
  return [
    ...results.flatMap(({ frameId, result }) =>
      (result?.items || []).map((item) => ({ ...item, frameId })),
    ),
    ...observed,
  ]
    .filter((item) => {
      const key = `${item.kind}:${item.url}:${/^(canvas:|svg:)/.test(item.url) ? item.frameId : ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 1000);
}
function save(item, tabId, naming = {}) {
  const key = `${tabId}:${item.kind}:${item.url}`;
  if (pendingSaves.has(key)) return pendingSaves.get(key);
  const task = (async () => {
    const records = await browser.storage.session.get(null);
    const active = Object.entries(records).find(
      ([key, record]) =>
        key.startsWith("download:") &&
        record.tabId === tabId &&
        record.item.url === item.url &&
        record.item.kind === item.kind,
    );
    if (active) {
      const id = Number(active[0].slice("download:".length));
      const [download] = await browser.downloads.search({ id });
      if (download?.state === "in_progress") return id;
    }
    try {
      return await startSave(item, tabId, naming);
    } catch (error) {
      if (canceled(error)) return null;
      throw error;
    }
  })();
  pendingSaves.set(key, task);
  task
    .finally(() => {
      if (pendingSaves.get(key) === task) pendingSaves.delete(key);
    })
    .catch(() => {});
  return task;
}
async function startSave(item, tabId, naming) {
  if (U.issue(item)) throw new Error(U.issue(item));
  const tab = await browser.tabs.get(tabId);
  let url = item.url;
  if (url.startsWith("file:") && !tab.url?.startsWith("file:"))
    throw new Error("Local files can only be saved from a local file page.");
  if (/^(canvas:|svg:)/.test(url)) {
    const result = await browser.tabs.sendMessage(
      tabId,
      { type: url.startsWith("svg:") ? "svg" : "canvas", ref: item.ref },
      { frameId: item.frameId ?? 0 },
    );
    if (result.error) throw new Error(result.error);
    url = result.url;
  }
  if (url.startsWith("blob:") && item.kind === "image") {
    const result = await browser.tabs.sendMessage(
      tabId,
      { type: "blob-image", url },
      { frameId: item.frameId ?? 0 },
    );
    if (result.error) throw new Error(result.error);
    url = result.url;
  }
  if (!U.usableURL(url))
    throw new Error("This page did not expose a downloadable media URL.");
  // Always let the user choose the destination in the browser file dialog.
  const filename = naming.template
    ? U.templatedFilename({ ...item, url }, naming.template, naming.index)
    : U.filename({ ...item, url });
  const options = { url, filename, saveAs: true, conflictAction: "uniquify" };
  if (RS.isFirefox) options.incognito = tab.incognito;
  // downloads.download requires the cookies permission for cookieStoreId.
  // RightSave never reads cookie values; Firefox sends the appropriate cookies itself.
  if (RS.isFirefox && tab.cookieStoreId)
    options.cookieStoreId = tab.cookieStoreId;
  if (
    RS.isFirefox &&
    /^https?:/.test(url) &&
    /^https?:/.test(item.pageURL || "")
  ) {
    const page = new URL(item.pageURL);
    const media = new URL(url);
    if (!(page.protocol === "https:" && media.protocol === "http:")) {
      options.headers = [{ name: "Referer", value: page.origin + "/" }];
    }
  }
  // Firefox's downloads API rejects data URLs; use an extension-owned Blob URL.
  let ownedBlobURL = "";
  if (RS.isFirefox && url.startsWith("data:")) {
    const blob = await (await fetch(url)).blob();
    ownedBlobURL = URL.createObjectURL(blob);
    options.url = ownedBlobURL;
  }
  let downloadId;
  try {
    downloadId = await browser.downloads.download(options);
  } catch (error) {
    if (ownedBlobURL) URL.revokeObjectURL(ownedBlobURL);
    throw error;
  }
  await browser.storage.session.set({
    ["download:" + downloadId]: {
      tabId,
      item,
      ownedBlobURL,
      created: Date.now(),
    },
  });
  // Small/data URL downloads can finish before the listener's bookkeeping is stored.
  const [download] = await browser.downloads.search({ id: downloadId });
  if (download?.state === "complete") await releaseDownload(downloadId);
  if (download?.state === "interrupted")
    await handleInterrupted(downloadId, download.error);
  return downloadId;
}
async function releaseDownload(id) {
  const key = "download:" + id;
  const record = (await browser.storage.session.get(key))[key];
  if (record?.ownedBlobURL) URL.revokeObjectURL(record.ownedBlobURL);
  await browser.storage.session.remove(key);
}
async function handleInterrupted(id, reason) {
  const key = "download:" + id;
  const record = (await browser.storage.session.get(key))[key];
  await releaseDownload(id);
  if (!record || /USER_CANCELED/i.test(reason || "")) return;
  try {
    const tab = await browser.tabs.get(record.tabId);
    await openPicker(
      tab,
      [record.item],
      `The browser could not finish the download (${reason || "network or server error"}). Keep the source post open, play the video, then rescan. Signed social-media links can expire.`,
      "Download needs attention",
    );
  } catch {
    /* The source tab was closed. Firefox retains its download error. */
  }
}
browser.downloads.onChanged.addListener((delta) => {
  if (delta.state?.current === "interrupted")
    handleInterrupted(delta.id, delta.error?.current).catch(console.error);
  if (delta.state?.current === "complete")
    releaseDownload(delta.id).catch(console.error);
});
browser.menus.onClicked.addListener(async (info, tab) => {
  try {
    if (info.menuItemId === MENU.page)
      return await openPicker(
        tab,
        await scan(tab.id),
        "",
        "Media on this page",
      );
    const items = await contextItems(info, tab);
    if (info.menuItemId === MENU.here) return await openPicker(tab, items);
    const kind =
      info.menuItemId === MENU.image
        ? "image"
        : info.menuItemId === MENU.video
          ? "video"
          : null;
    if (!kind) return;
    const item = items.find((i) => i.kind === kind && !U.issue(i));
    if (!item)
      throw new Error(
        "No downloadable media found here. Choose Find images and videos on this page, or refresh the webpage and try again.",
      );
    try {
      await save(item, tab.id);
    } catch (error) {
      await openPicker(tab, [item], error.message, "Download needs attention");
    }
  } catch (error) {
    if (tab)
      await openPicker(
        tab,
        [],
        error.message + " Refresh the webpage after installing RightSave.",
      );
  }
});
RS.listen((message, sender) => {
  if (!message || typeof message !== "object") return;
  if (
    message.type === "quick-save" &&
    sender.tab &&
    sender.id === browser.runtime.id
  )
    return (async () => {
      const item = {
        ...message.item,
        frameId: sender.frameId ?? 0,
        pageURL: sender.url,
      };
      if (item.audio === "separate") {
        await openPicker(
          sender.tab,
          [item],
          "This source exposes a video-only file. Its audio is separate; choose Save video only if you want the silent file.",
          "Media at this spot",
        );
        return { needsChoice: true };
      }
      try {
        return { id: await save(item, sender.tab.id) };
      } catch (error) {
        await openPicker(
          sender.tab,
          [item],
          error.message,
          "Download needs attention",
        );
        return { error: error.message };
      }
    })();
  // Only extension pages can ask the background to scan, open tabs, or start downloads.
  if (
    sender.id !== browser.runtime.id ||
    !sender.url?.startsWith(browser.runtime.getURL(""))
  )
    return;
  if (message.type === "browse")
    return (async () => {
      try {
        const tab = await browser.tabs.get(message.tabId);
        await openPicker(tab, await scan(tab.id), "", "Media on this page");
        return { ok: true };
      } catch {
        return {
          error:
            "This page is unavailable to extensions. Try a regular webpage and refresh it after installing RightSave.",
        };
      }
    })();
  if (message.type === "clear-lists")
    return (async () => {
      await clearNetwork();
      const stored = await browser.storage.session.get(null);
      await browser.storage.session.remove(
        Object.keys(stored).filter((key) => /^(picker:|network:)/.test(key)),
      );
      return { ok: true };
    })();
  if (message.type === "save")
    return (async () => {
      try {
        return {
          id: await save(message.item, message.tabId, {
            template: message.template,
            index: message.index,
          }),
        };
      } catch (error) {
        return { error: error.message };
      }
    })();
  if (message.type === "archive-source")
    return (async () => {
      try {
        const item = message.item,
          tab = await browser.tabs.get(message.tabId);
        if (U.issue(item)) throw new Error(U.issue(item));
        if (
          RS.isFirefox &&
          tab.cookieStoreId &&
          tab.cookieStoreId !== "firefox-default"
        )
          throw new Error(
            "ZIP export cannot use a Firefox container session. Use individual Save As for these files.",
          );
        let url = item.url;
        if (url.startsWith("file:") && !tab.url?.startsWith("file:"))
          throw new Error(
            "Local files can only be saved from a local file page.",
          );
        if (/^(canvas:|svg:|blob:)/.test(url)) {
          const type = url.startsWith("canvas:")
            ? "canvas"
            : url.startsWith("svg:")
              ? "svg"
              : "blob-image";
          const result = await browser.tabs.sendMessage(
            message.tabId,
            { type, ref: item.ref, url },
            { frameId: item.frameId ?? 0 },
          );
          if (result.error) throw new Error(result.error);
          url = result.url;
        }
        if (!U.usableURL(url))
          throw new Error("This file has no downloadable URL.");
        return { url, filename: U.filename(item) };
      } catch (error) {
        return { error: error.message };
      }
    })();
  if (message.type === "save-archive")
    return (async () => {
      try {
        if (
          typeof message.url !== "string" ||
          !message.url.startsWith("blob:" + browser.runtime.getURL(""))
        )
          throw new Error("Invalid archive URL.");
        return {
          id: await save(
            {
              url: message.url,
              kind: "document",
              mime: "application/zip",
              suggestedName: "rightsave-collection.zip",
            },
            message.tabId,
          ),
        };
      } catch (error) {
        return { error: error.message };
      }
    })();
  if (message.type === "save-converted")
    return (async () => {
      try {
        if (
          typeof message.url !== "string" ||
          !message.url.startsWith("blob:" + browser.runtime.getURL("")) ||
          !["image/png", "image/jpeg", "image/webp"].includes(message.mime)
        )
          throw new Error("Invalid converted image.");
        return {
          id: await save(
            {
              url: message.url,
              kind: "document",
              mime: message.mime,
              suggestedName: message.filename,
            },
            message.tabId,
          ),
        };
      } catch (error) {
        return { error: error.message };
      }
    })();
  if (message.type === "save-workflow-pack")
    return (async () => {
      try {
        if (typeof message.text !== "string" || message.text.length > 50000)
          throw new Error("Invalid workflow pack.");
        return {
          id: await save(
            {
              url:
                "data:application/json;charset=utf-8," +
                encodeURIComponent(message.text),
              kind: "document",
              mime: "application/json",
              suggestedName: "rightsave-workflows.json",
            },
            message.tabId,
          ),
        };
      } catch (error) {
        return { error: error.message };
      }
    })();
  if (message.type === "save-batch")
    return (async () => {
      try {
        if (
          !Array.isArray(message.items) ||
          !message.items.length ||
          message.items.length > 100
        )
          throw new Error("Select between 1 and 100 files for a batch.");
        const results = [];
        for (const [index, item] of message.items.entries()) {
          const id = await save(item, message.tabId, {
            template: message.template,
            index: index + 1,
          });
          results.push({ id });
          if (id === null) return { results, canceled: true };
        }
        return { results };
      } catch (error) {
        return { error: error.message };
      }
    })();
  if (message.type === "export-list")
    return (async () => {
      try {
        const json = U.mediaList(message.items);
        const url =
          "data:application/json;charset=utf-8," + encodeURIComponent(json);
        return {
          id: await save(
            {
              url,
              kind: "document",
              mime: "application/json",
              suggestedName: "rightsave-media.json",
            },
            message.tabId,
          ),
        };
      } catch (error) {
        return { error: error.message };
      }
    })();
  if (message.type === "video-frame")
    return (async () => {
      try {
        const result = await browser.tabs.sendMessage(
          message.tabId,
          { type: "video-frame", ref: message.item.ref },
          { frameId: message.item.frameId ?? 0 },
        );
        if (result.error) throw new Error(result.error);
        const suggestedName =
          U.filename(message.item).replace(/\.[^.]+$/, "") + "-frame.png";
        return {
          id: await save(
            {
              ...message.item,
              url: result.url,
              kind: "image",
              mime: "image/png",
              suggestedName,
            },
            message.tabId,
          ),
        };
      } catch (error) {
        return { error: error.message };
      }
    })();
  if (message.type === "preview")
    return (async () => {
      try {
        const item = message.item;
        const type = item.url.startsWith("svg:")
          ? "svg"
          : item.url.startsWith("blob:")
            ? "blob-image"
            : "thumbnail";
        return await browser.tabs.sendMessage(
          message.tabId,
          { type, ref: item.ref, url: item.url },
          { frameId: item.frameId ?? 0 },
        );
      } catch {
        return {
          error:
            "The source page is unavailable. Rescan it to refresh previews.",
        };
      }
    })();
  if (message.type === "rescan")
    return (async () => {
      try {
        return { items: await scan(message.tabId) };
      } catch {
        return {
          error:
            "The source tab is closed or unavailable. Return to the webpage and open RightSave again.",
        };
      }
    })();
});

browser.commands.onCommand.addListener(async (command) => {
  if (command !== "open-library") return;
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab)
    try {
      await openPicker(tab, await scan(tab.id), "", "Media on this page");
    } catch (error) {
      await openPicker(tab, [], error.message);
    }
});

// Response observation is optional and keeps no persistent browsing log.
let networkWrites = Promise.resolve(),
  networkEpoch = 0;
const tabEpoch = new Map();
function observeMedia(details) {
  if (details.tabId < 0) return;
  const mime =
    details.responseHeaders
      ?.find((h) => h.name.toLowerCase() === "content-type")
      ?.value?.split(";")[0] || "";
  if (
    !/^(video\/(mp4|webm|ogg)|application\/(mp4|vnd\.apple\.mpegurl|x-mpegurl|dash\+xml))$/i.test(
      mime,
    ) ||
    /\.(m4s|cmfv|cmfa|ts)(?:[?#]|$)/i.test(details.url) ||
    !U.usableURL(details.url)
  )
    return;
  const epoch = networkEpoch,
    route = tabEpoch.get(details.tabId) || 0,
    key = "network:" + details.tabId;
  networkWrites = networkWrites
    .then(async () => {
      if (
        epoch !== networkEpoch ||
        route !== (tabEpoch.get(details.tabId) || 0)
      )
        return;
      const tab = await browser.tabs.get(details.tabId).catch(() => null);
      if (!tab) return;
      const { disabledSites = [] } =
        await browser.storage.local.get("disabledSites");
      if (disabledSites.includes(new URL(tab.url).hostname)) return;
      const values = (await browser.storage.session.get(key))[key] || [];
      if (
        epoch !== networkEpoch ||
        route !== (tabEpoch.get(details.tabId) || 0)
      )
        return;
      const item = {
        url: details.url,
        kind: "video",
        mime,
        source: "Detected video request",
        frameId: details.frameId ?? 0,
        pageURL: details.documentUrl || details.initiator || "",
        audio: /^https:\/\/v\.redd\.it\/.+\/DASH_/.test(details.url)
          ? "separate"
          : "unknown",
      };
      await browser.storage.session.set({
        [key]: [item, ...values.filter((i) => i.url !== item.url)].slice(0, 60),
      });
    })
    .catch(() => {});
}
function installNetworkObserver() {
  try {
    if (
      browser.webRequest?.onHeadersReceived &&
      !browser.webRequest.onHeadersReceived.hasListener(observeMedia)
    )
      browser.webRequest.onHeadersReceived.addListener(
        observeMedia,
        { urls: ["http://*/*", "https://*/*"] },
        ["responseHeaders"],
      );
  } catch {
    /* Optional permission has not been granted. */
  }
}
async function clearNetwork() {
  networkEpoch++;
  await networkWrites;
  const stored = await browser.storage.session.get(null);
  await browser.storage.session.remove(
    Object.keys(stored).filter((k) => k.startsWith("network:")),
  );
}
installNetworkObserver();
browser.permissions.onAdded.addListener((permissions) => {
  if (!permissions.permissions?.includes("webRequest")) return;
  browser.webRequest?.onHeadersReceived.removeListener(observeMedia);
  installNetworkObserver();
});
browser.permissions.onRemoved.addListener(async (permissions) => {
  if (!permissions.permissions?.includes("webRequest")) return;
  browser.webRequest?.onHeadersReceived.removeListener(observeMedia);
  await clearNetwork();
});
browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.disabledSites) clearNetwork().catch(() => {});
});
browser.tabs.onRemoved.addListener(async (tabId) => {
  tabEpoch.set(tabId, (tabEpoch.get(tabId) || 0) + 1);
  await networkWrites;
  const stored = await browser.storage.session.get(null);
  await browser.storage.session.remove(
    Object.keys(stored).filter(
      (key) =>
        key === "network:" + tabId ||
        (key.startsWith("picker:") &&
          (stored[key].tabId === tabId || stored[key].libraryTabId === tabId)),
    ),
  );
  tabEpoch.delete(tabId);
});
browser.tabs.onUpdated.addListener((tabId, change) => {
  if (change.url) {
    tabEpoch.set(tabId, (tabEpoch.get(tabId) || 0) + 1);
    networkWrites = networkWrites
      .then(() => browser.storage.session.remove("network:" + tabId))
      .catch(() => {});
  }
});
