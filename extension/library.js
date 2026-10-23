(async () => {
  const U = RightSaveUtil,
    $ = (id) => document.getElementById(id);
  const key = "picker:" + new URL(location.href).searchParams.get("session");
  const data = (await browser.storage.session.get(key))[key];
  const settings = await browser.storage.local.get({
    thumbnailSize: "large",
    theme: "dark",
    quickSave: true,
  });
  document.documentElement.dataset.theme = settings.theme;
  function notice(text) {
    $("notice").hidden = !text;
    $("notice").textContent = text;
  }
  $("quick-toggle").checked = settings.quickSave;
  $("quick-toggle").onchange = async () => {
    await browser.storage.local.set({ quickSave: $("quick-toggle").checked });
    notice(
      $("quick-toggle").checked
        ? "Right-click Save As enabled on active sites."
        : "Use the RightSave submenu when you right-click media.",
    );
  };
  if (!data) {
    notice(
      "This library expired. Return to the source webpage and open RightSave again.",
    );
    $("rescan").disabled = true;
    $("load-all").disabled = true;
    return;
  }
  let filter = "all",
    size = settings.thumbnailSize,
    busy = false,
    previewController,
    zoomItem,
    zoomEpoch = 0,
    zoomPlaybackStarted = false;
  const selected = new Set(),
    previews = new Map(),
    rows = new Map();
  const id = (item) => `${item.frameId || 0}:${item.kind}:${item.url}`;
  const send = (message) =>
    browser.runtime.sendMessage({ ...message, tabId: data.tabId });
  $("heading").textContent = data.title.includes("spot")
    ? "Right here."
    : "Your media.";
  $("pageTitle").textContent = data.pageTitle;
  notice(data.notice);
  function visibleItems() {
    return RightSaveGallery.filter(data.items, {
      query: $("search").value,
      kind: filter,
      minWidth: Number($("min-width").value) || 0,
      format: $("format").value,
      orientation: $("orientation").value,
      unique: $("unique").checked,
      sort: $("sort").value,
    });
  }
  function updateSelection() {
    $("selection-dock").hidden = !selected.size;
    $("dock-count").textContent = `${selected.size} selected`;
    $("dock-zip").disabled = busy;
    $("save-selected").textContent = `Save selected (${selected.size})`;
    $("save-selected").disabled = !selected.size || busy;
    $("save-zip").disabled = !selected.size || busy;
    const available = visibleItems().filter((i) => !U.issue(i));
    $("select-visible").checked =
      available.length > 0 && available.every((i) => selected.has(id(i)));
    $("select-visible").indeterminate =
      available.some((i) => selected.has(id(i))) &&
      !$("select-visible").checked;
  }
  function showPreview(item) {
    const row = rows.get(id(item)),
      cache = previews.get(id(item));
    if (!row || !cache?.image) return;
    row.preview.replaceChildren(cache.image);
    row.preview.classList.add("ready");
    cache.image.tabIndex = 0;
    cache.image.setAttribute("role", "button");
    cache.image.setAttribute(
      "aria-label",
      "Expand " + (item.label || U.filename(item)),
    );
    cache.image.onclick = () => openZoom(item);
    cache.image.onkeydown = (event) => {
      if (["Enter", " "].includes(event.key)) {
        event.preventDefault();
        openZoom(item);
      }
    };
  }
  async function loadPreview(item, signal) {
    const identity = id(item),
      existing = previews.get(identity);
    if (existing?.image) {
      showPreview(item);
      return true;
    }
    if (existing?.promise) return existing.promise;
    const task = (async () => {
      const row = rows.get(identity);
      if (row) row.load.textContent = "Loading…";
      try {
        if (signal?.aborted) throw new DOMException("Canceled", "AbortError");
        let url = item.kind === "video" ? item.poster : item.url;
        if (!url || /^(canvas:|svg:|blob:)/.test(url)) {
          const result = await send({ type: "preview", item });
          if (result.error) throw new Error(result.error);
          url = result.url;
        }
        if (signal?.aborted) throw new DOMException("Canceled", "AbortError");
        const img = new Image();
        img.alt = item.label || U.filename(item);
        img.referrerPolicy = "no-referrer";
        await new Promise((resolve, reject) => {
          const finish = (error) => {
            clearTimeout(timer);
            signal?.removeEventListener("abort", abort);
            img.onload = null;
            img.onerror = null;
            error ? reject(error) : resolve();
          };
          const abort = () => {
            img.src = "";
            finish(new DOMException("Canceled", "AbortError"));
          };
          const timer = setTimeout(() => {
            img.src = "";
            finish(new Error("Preview timed out."));
          }, 12000);
          signal?.addEventListener("abort", abort, { once: true });
          img.onload = () => finish();
          img.onerror = () =>
            finish(new Error("This host could not provide a preview."));
          img.src = url;
        });
        if (!item.width && img.naturalWidth) {
          item.width = img.naturalWidth;
          item.height = img.naturalHeight;
        }
        previews.set(identity, { image: img });
        showPreview(item);
        return true;
      } catch (error) {
        previews.delete(identity);
        const current = rows.get(identity);
        if (current) {
          current.load.textContent =
            error.name === "AbortError" ? "Load preview" : "Retry preview";
          current.load.title = error.message;
        }
        return false;
      }
    })();
    previews.set(identity, { promise: task });
    return task;
  }
  function render() {
    rows.clear();
    $("media").replaceChildren();
    $("media").classList.toggle("size-xl", size === "xl");
    document
      .querySelectorAll("[data-size]")
      .forEach((b) =>
        b.setAttribute("aria-pressed", String(b.dataset.size === size)),
      );
    const values = visibleItems();
    $("count").textContent =
      `${values.length} ${values.length === 1 ? "item" : "items"}${data.items.length >= 1000 ? " · first 1,000" : ""}`;
    $("empty").hidden = values.length > 0;
    for (const item of values) {
      const identity = id(item),
        issue = U.issue(item),
        card = document.createElement("article");
      card.className = "media-card";
      const preview = document.createElement("div");
      preview.className = "preview";
      const symbol = document.createElement("span");
      symbol.className = "media-symbol";
      symbol.textContent = item.kind === "video" ? "▷" : "▧";
      const load = document.createElement("button");
      load.className = "preview-button";
      load.textContent =
        item.kind === "video" ? "Load frame preview" : "Load preview";
      load.onclick = () => loadPreview(item);
      preview.append(symbol, load);
      const body = document.createElement("div");
      body.className = "card-body";
      const source = document.createElement("p");
      source.className = "source";
      source.textContent = item.source;
      const heading = document.createElement("h2");
      heading.textContent = item.label || U.filename(item);
      heading.title = heading.textContent;
      const detail = document.createElement("p");
      detail.className = "detail";
      let host = "";
      try {
        host = new URL(item.url).hostname;
      } catch {}
      detail.textContent = [
        item.width && item.height
          ? `${item.width} × ${item.height}`
          : "Dimensions unavailable",
        item.audio === "separate"
          ? "Video only · separate audio"
          : item.audio === "none"
            ? "No audio in source"
            : "",
        host,
      ]
        .filter(Boolean)
        .join(" · ");
      const warning =
        item.audio === "separate"
          ? "Audio is delivered separately. This saves the video track only; audio merging is not available in this build."
          : "";
      const problem = document.createElement("p");
      problem.className = "problem";
      problem.textContent = issue || warning;
      problem.hidden = !(issue || warning);
      const actions = document.createElement("div");
      actions.className = "card-actions";
      const save = document.createElement("button");
      save.className = "primary";
      save.textContent =
        item.audio === "separate" ? "Save video only" : `Save ${item.kind}`;
      save.disabled = !!issue;
      const status = document.createElement("p");
      status.className = "status";
      status.setAttribute("role", "status");
      const act = async (type, button) => {
        button.disabled = true;
        status.textContent = "Opening Save As…";
        try {
          const result = await send({ type, item });
          status.textContent =
            result.error ||
            (result.id === null
              ? "Save canceled."
              : "Sent to browser Downloads. Check its progress there.");
        } catch {
          status.textContent =
            "Could not start the download. Rescan the source page and try again.";
        }
        button.disabled = type === "save" && !!issue;
      };
      save.onclick = () => act("save", save);
      actions.append(save);
      if (item.kind === "video" && item.ref) {
        const frame = document.createElement("button");
        frame.className = "text-button";
        frame.textContent = "Save frame";
        frame.onclick = () => act("video-frame", frame);
        actions.append(frame);
      }
      if (U.videoPreviewURL(item, data.pageURL)) {
        const play = document.createElement("button");
        play.className = "text-button video-preview";
        play.textContent = "Preview video";
        play.onclick = () => openZoom(item);
        actions.append(play);
      }
      if (/^(https?:|file:)/.test(item.url)) {
        const link = document.createElement("a");
        link.className = "text-link";
        link.textContent = "Open original";
        link.href = item.url;
        link.target = "_blank";
        link.rel = "noreferrer";
        actions.append(link);
        const copy = document.createElement("button");
        copy.className = "text-button copy-link";
        copy.textContent = "Copy link";
        copy.onclick = () =>
          navigator.clipboard.writeText(item.url).then(
            () => {
              status.textContent =
                "Link copied. Signed links may expire; keep them private.";
            },
            () => {
              status.textContent =
                "Clipboard access is unavailable. Open the original and copy its address.";
            },
          );
        actions.append(copy);
      }
      const selection = document.createElement("label");
      selection.className = "tile-select";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = selected.has(identity);
      box.disabled = !!issue;
      box.setAttribute("aria-label", "Select " + heading.textContent);
      box.onchange = () => {
        box.checked ? selected.add(identity) : selected.delete(identity);
        updateSelection();
      };
      selection.append(box, document.createTextNode("Select"));
      body.append(source, heading, detail, problem, actions, status);
      card.append(preview, selection, body);
      rows.set(identity, { preview, load, box });
      $("media").append(card);
      showPreview(item);
    }
    updateSelection();
  }
  $("load-all").onclick = async () => {
    const values = [...visibleItems()];
    let cursor = 0,
      loaded = 0,
      failed = 0;
    previewController = new AbortController();
    const signal = previewController.signal;
    $("cancel-previews").hidden = false;
    $("load-all").disabled = true;
    try {
      await Promise.all(
        Array.from({ length: Math.min(6, values.length) }, async () => {
          while (cursor < values.length && !signal.aborted) {
            const item = values[cursor++];
            (await loadPreview(item, signal)) ? loaded++ : failed++;
            $("load-all").textContent =
              `Loading ${loaded + failed} / ${values.length}…`;
          }
        }),
      );
      notice(
        signal.aborted
          ? `Loading stopped. ${loaded} previews are ready.`
          : `Loaded ${loaded} previews${failed ? `; ${failed} unavailable. Try opening the post or playing its video.` : "."}`,
      );
    } finally {
      $("load-all").textContent = "Load all previews";
      $("load-all").disabled = false;
      $("cancel-previews").hidden = true;
      previewController = null;
    }
  };
  $("cancel-previews").onclick = () => previewController?.abort();
  document.querySelectorAll("[data-filter]").forEach(
    (b) =>
      (b.onclick = () => {
        filter = b.dataset.filter;
        document
          .querySelectorAll("[data-filter]")
          .forEach((e) => e.setAttribute("aria-pressed", String(e === b)));
        render();
      }),
  );
  document.querySelectorAll("[data-size]").forEach(
    (b) =>
      (b.onclick = async () => {
        size = b.dataset.size;
        await browser.storage.local.set({ thumbnailSize: size });
        render();
      }),
  );
  for (const control of ["search", "min-width"])
    $(control).addEventListener("input", render);
  for (const control of ["sort", "format", "orientation", "unique"])
    $(control).addEventListener("change", render);
  $("clear-filters").onclick = () => {
    filter = "all";
    $("search").value = "";
    $("min-width").value = "0";
    $("format").value = "all";
    $("orientation").value = "all";
    $("unique").checked = false;
    $("sort").value = "page";
    document
      .querySelectorAll("[data-filter]")
      .forEach((b) =>
        b.setAttribute("aria-pressed", String(b.dataset.filter === "all")),
      );
    render();
    notice("");
  };
  $("invert-selection").onclick = () => {
    for (const item of visibleItems().filter((i) => !U.issue(i))) {
      const value = id(item);
      selected.has(value) ? selected.delete(value) : selected.add(value);
    }
    render();
  };
  $("clear-selection").onclick = () => {
    selected.clear();
    render();
  };
  $("dock-clear").onclick = () => {
    if (!busy) {
      selected.clear();
      render();
    }
  };
  $("dock-zip").onclick = () => $("save-zip").click();
  $("dock-tools").onclick = () => {
    $("library-tools").open = true;
    $("library-tools").scrollIntoView({ block: "start" });
  };
  $("library-tip").hidden = !!(
    await browser.storage.local.get("libraryTipDismissed")
  ).libraryTipDismissed;
  $("dismiss-tip").onclick = async () => {
    $("library-tip").hidden = true;
    await browser.storage.local.set({ libraryTipDismissed: true });
  };
  $("select-visible").onchange = () => {
    for (const item of visibleItems().filter((i) => !U.issue(i)))
      $("select-visible").checked
        ? selected.add(id(item))
        : selected.delete(id(item));
    render();
  };
  $("rescan").onclick = async () => {
    if (busy) return;
    previewController?.abort();
    $("rescan").disabled = true;
    try {
      const result = await send({ type: "rescan" });
      if (result.error) notice(result.error);
      else {
        data.items = result.items;
        data.title = "Media on this page";
        data.notice = "";
        data.created = Date.now();
        selected.clear();
        await browser.storage.session.set({ [key]: data });
        $("heading").textContent = "Your media.";
        notice("");
        render();
      }
    } catch {
      notice(
        "Rescan failed. Return to the source page and open RightSave again.",
      );
    } finally {
      $("rescan").disabled = false;
    }
  };
  let stopBatch = false;
  $("cancel-batch").onclick = () => {
    stopBatch = true;
    $("cancel-batch").disabled = true;
    $("cancel-batch").textContent = "Stopping after this file…";
  };
  $("save-selected").onclick = async () => {
    const items = data.items.filter((i) => selected.has(id(i)));
    if (!items.length || items.length > 100) {
      notice("Select 1–100 files for a batch.");
      return;
    }
    busy = true;
    stopBatch = false;
    updateSelection();
    $("cancel-batch").hidden = false;
    $("cancel-batch").disabled = false;
    let started = 0;
    try {
      for (const [index, item] of items.entries()) {
        if (stopBatch) break;
        notice(
          `Save As for file ${index + 1} of ${items.length}. Cancel a dialog to stop the queue.`,
        );
        const result = await send({
          type: "save",
          item,
          index: index + 1,
        });
        if (result.error) throw new Error(result.error);
        if (result.id === null) {
          stopBatch = true;
          break;
        }
        started++;
      }
      notice(
        `${started} ${started === 1 ? "file" : "files"} sent to Downloads.${stopBatch ? " Queue stopped. Files already started can finish." : ""}`,
      );
    } catch (error) {
      notice(
        error.message ||
          "The batch could not finish. Check Downloads for files already started.",
      );
    } finally {
      busy = false;
      $("cancel-batch").hidden = true;
      $("cancel-batch").textContent = "Stop after this file";
      updateSelection();
    }
  };
  $("export").onclick = async () => {
    const result = await send({ type: "export-list", items: visibleItems() });
    notice(
      result.error ||
        (result.id === null
          ? "Export canceled."
          : "Source list sent to Downloads. Links omit query strings; paths can still identify private posts."),
    );
  };
  let zipController;
  $("cancel-zip").onclick = () => zipController?.abort();
  $("save-zip").onclick = async () => {
    const items = data.items.filter((i) => selected.has(id(i)));
    if (!items.length || items.length > 100) {
      notice("Select 1–100 files for a ZIP.");
      return;
    }
    busy = true;
    updateSelection();
    zipController = new AbortController();
    $("cancel-zip").hidden = false;
    $("archive-status").textContent = `Preparing ${items.length} files…`;
    let owned = "";
    try {
      const zip = new RightSaveCollections.Zip(),
        records = [],
        hashes = new Set();
      let skipped = 0;
      const withRecords = $("source-records").checked;
      if (withRecords) {
        if (items.length > 98)
          throw new Error(
            "Select up to 98 files to leave room for two source records.",
          );
      }
      for (const [index, item] of items.entries()) {
        if (zipController.signal.aborted)
          throw new DOMException("Canceled", "AbortError");
        $("archive-status").textContent =
          `Preparing ${index + 1} / ${items.length}…`;
        const source = await send({ type: "archive-source", item });
        if (source.error) throw new Error(source.error);
        const timer = setTimeout(() => zipController.abort(), 30000);
        let bytes;
        try {
          bytes = await RightSaveCollections.fetchFile(
            source.url,
            zipController.signal,
          );
        } finally {
          clearTimeout(timer);
        }
        if ($("dedupe-zip").checked) {
          const hash = await RightSaveGallery.digest(bytes);
          if (hashes.has(hash)) {
            skipped++;
            continue;
          }
          hashes.add(hash);
        }
        const filename = zip.add(source.filename, bytes);
        records.push({
          filename,
          item: { ...item, pageURL: item.pageURL || data.pageURL },
          bytes: bytes.length,
        });
      }
      if (withRecords) {
        const record = RightSaveCollections.sourceRecords(records);
        zip.add(
          U.randomFilename({ kind: "document", mime: "application/json" }),
          new TextEncoder().encode(record.json),
        );
        zip.add(
          U.randomFilename({ kind: "document", mime: "text/csv" }),
          new TextEncoder().encode(record.csv),
        );
      }
      owned = URL.createObjectURL(zip.blob());
      const result = await send({ type: "save-archive", url: owned });
      if (result.error) throw new Error(result.error);
      if (result.id === null) {
        $("archive-status").textContent = "ZIP save canceled.";
        URL.revokeObjectURL(owned);
        owned = "";
      } else {
        $("archive-status").textContent =
          `${records.length} files packaged.${skipped ? ` ${skipped} duplicate${skipped === 1 ? "" : "s"} skipped.` : ""} Check browser Downloads.`;
        const url = owned;
        owned = "";
        const release = (delta) => {
          if (
            delta.id === result.id &&
            ["complete", "interrupted"].includes(delta.state?.current)
          ) {
            URL.revokeObjectURL(url);
            browser.downloads.onChanged.removeListener(release);
          }
        };
        browser.downloads.onChanged.addListener(release);
        const [download] = await browser.downloads.search({ id: result.id });
        if (download && download.state !== "in_progress")
          release({ id: result.id, state: { current: download.state } });
      }
    } catch (error) {
      $("archive-status").textContent =
        error.name === "AbortError"
          ? "ZIP preparation canceled or timed out. No partial archive was saved."
          : error.message;
    } finally {
      if (owned) URL.revokeObjectURL(owned);
      busy = false;
      zipController = null;
      $("cancel-zip").hidden = true;
      updateSelection();
    }
  };
  async function refreshPresets() {
    const values = await RightSaveCollections.presets();
    $("preset").replaceChildren(
      new Option("Choose a workflow", ""),
      ...values.map((p) => new Option(p.name, p.name)),
    );
  }
  $("save-preset").onclick = async () => {
    try {
      const p = await RightSaveCollections.savePreset({
        name: $("preset-name").value,
        template: "",
        search: $("search").value,
        minWidth: $("min-width").value,
        filter,
        sort: $("sort").value,
        size,
        format: $("format").value,
        orientation: $("orientation").value,
        unique: $("unique").checked,
      });
      await refreshPresets();
      $("preset").value = p.name;
      notice("Workflow saved on this browser.");
    } catch (error) {
      notice(error.message);
    }
  };
  $("apply-preset").onclick = async () => {
    try {
      const p = (await RightSaveCollections.presets()).find(
        (p) => p.name === $("preset").value,
      );
      if (!p) throw new Error("Choose a saved workflow.");
      filter = p.filter;
      size = p.size;
      $("search").value = p.search;
      $("min-width").value = p.minWidth;
      $("sort").value = p.sort;
      $("preset-name").value = p.name;
      $("format").value = p.format;
      $("orientation").value = p.orientation;
      $("unique").checked = p.unique;
      document
        .querySelectorAll("[data-filter]")
        .forEach((b) =>
          b.setAttribute("aria-pressed", String(b.dataset.filter === filter)),
        );
      render();
      notice("Workflow applied.");
    } catch (error) {
      notice(error.message);
    }
  };
  $("delete-preset").onclick = async () => {
    try {
      await RightSaveCollections.removePreset($("preset").value);
      await refreshPresets();
      notice("Workflow removed.");
    } catch (error) {
      notice(error.message);
    }
  };
  await refreshPresets();
  $("export-pack").onclick = async () => {
    try {
      const text = await RightSaveCollections.exportPack(),
        result = await send({ type: "save-workflow-pack", text });
      notice(
        result.error ||
          (result.id === null
            ? "Export canceled."
            : "Workflow pack sent to browser Downloads."),
      );
    } catch (error) {
      notice(error.message);
    }
  };
  $("import-pack").onclick = () => $("pack-file").click();
  $("pack-file").onchange = async () => {
    try {
      const file = $("pack-file").files[0];
      if (!file) return;
      if (file.size > 50000)
        throw new Error("Choose a workflow pack under 50 KB.");
      const count = await RightSaveCollections.importPack(await file.text());
      await refreshPresets();
      notice(`Imported ${count} workflows. Matching names were replaced.`);
    } catch (error) {
      notice(error.message);
    } finally {
      $("pack-file").value = "";
    }
  };
  function stopVideo() {
    const video = $("zoom-video");
    video.onplaying = null;
    video.onerror = null;
    video.pause();
    video.removeAttribute("src");
    video.removeAttribute("poster");
    video.load();
    video.hidden = true;
  }
  $("zoom-play").onclick = async () => {
    const item = zoomItem,
      epoch = zoomEpoch;
    if (!U.videoPreviewURL(item, data.pageURL)) return;
    zoomPlaybackStarted = true;
    const video = $("zoom-video");
    $("zoom-play").hidden = true;
    $("zoom-image").hidden = true;
    video.hidden = false;
    $("zoom-status").textContent = "Loading video…";
    const failed = () => {
      if (epoch !== zoomEpoch || !$("zoom").open) return;
      stopVideo();
      $("zoom-image").hidden = !$("zoom-image").hasAttribute("src");
      $("zoom-play").hidden = false;
      $("zoom-play").textContent = "Retry video preview";
      $("zoom-status").textContent =
        "This video could not play here. Try Save original, or open its source post.";
    };
    video.onerror = failed;
    video.onplaying = () => {
      if (epoch === zoomEpoch) $("zoom-status").textContent = "";
    };
    video.src = U.videoPreviewURL(item, data.pageURL);
    try {
      await video.play();
    } catch {
      failed();
    }
  };
  async function openZoom(item) {
    stopVideo();
    zoomPlaybackStarted = false;
    zoomItem = item;
    const epoch = ++zoomEpoch,
      values = visibleItems(),
      index = values.findIndex((v) => id(v) === id(item));
    $("zoom-title").textContent = item.label || U.filename(item);
    $("zoom-position").textContent =
      `${index + 1} of ${values.length}${item.width && item.height ? ` / ${item.width} × ${item.height}` : ""}${item.kind === "video" ? " / video" : ""}`;
    $("zoom-prev").disabled = index <= 0;
    $("zoom-next").disabled = index >= values.length - 1;
    $("zoom-save").disabled = !!U.issue(item);
    $("convert-tools").hidden = item.kind !== "image";
    $("zoom-status").textContent = "Loading preview…";
    $("zoom-image").hidden = true;
    $("zoom-image").removeAttribute("src");
    $("zoom-play").hidden = !U.videoPreviewURL(item, data.pageURL);
    $("zoom-play").textContent = "Play video preview";
    if (!$("zoom").open) $("zoom").showModal();
    const loaded = await loadPreview(item);
    if (epoch !== zoomEpoch || !$("zoom").open) return;
    if (!$("zoom-video").hidden) return;
    if (loaded) {
      $("zoom-image").src = previews.get(id(item)).image.src;
      $("zoom-image").alt = item.label || U.filename(item);
      $("zoom-image").hidden = false;
      if (!zoomPlaybackStarted) $("zoom-status").textContent = "";
    } else if (!zoomPlaybackStarted)
      $("zoom-status").textContent =
        "Preview unavailable. Try saving the original.";
  }
  function moveZoom(direction) {
    const values = visibleItems(),
      index = values.findIndex((v) => id(v) === id(zoomItem)),
      item = values[index + direction];
    if (item) openZoom(item);
  }
  $("zoom-prev").onclick = () => moveZoom(-1);
  $("zoom-next").onclick = () => moveZoom(1);
  $("zoom-save").onclick = async () => {
    if (!zoomItem) return;
    $("zoom-save").disabled = true;
    try {
      const result = await send({ type: "save", item: zoomItem });
      $("zoom-status").textContent =
        result.error ||
        (result.id === null ? "Save canceled." : "Sent to browser Downloads.");
    } catch {
      $("zoom-status").textContent =
        "Could not start the save. Rescan the source page.";
    } finally {
      $("zoom-save").disabled = !!U.issue(zoomItem);
    }
  };
  $("convert-save").onclick = async () => {
    const item = zoomItem,
      epoch = zoomEpoch;
    if (!item || item.kind !== "image") return;
    $("convert-save").disabled = true;
    let owned = "";
    try {
      $("zoom-status").textContent = "Converting on this device…";
      const source = await send({ type: "archive-source", item });
      if (source.error) throw new Error(source.error);
      const mime = $("convert-format").value,
        result = await RightSaveCollections.convert(
          source.url,
          mime,
          Number($("convert-size").value),
        );
      if (epoch !== zoomEpoch || !$("zoom").open) return;
      owned = URL.createObjectURL(result.blob);
      const ext = mime === "image/jpeg" ? "jpg" : mime.split("/")[1],
        filename = U.filename(item).replace(/\.[^.]+$/, "") + "." + ext;
      const saved = await send({
        type: "save-converted",
        url: owned,
        mime,
        filename,
      });
      if (saved.error) throw new Error(saved.error);
      if (saved.id === null) {
        $("zoom-status").textContent = "Save canceled.";
        return;
      }
      $("zoom-status").textContent =
        `Converted ${result.width} × ${result.height}. Check browser Downloads.`;
      const url = owned;
      owned = "";
      const release = (delta) => {
        if (
          delta.id === saved.id &&
          ["complete", "interrupted"].includes(delta.state?.current)
        ) {
          URL.revokeObjectURL(url);
          browser.downloads.onChanged.removeListener(release);
        }
      };
      browser.downloads.onChanged.addListener(release);
      const [download] = await browser.downloads.search({ id: saved.id });
      if (download && download.state !== "in_progress")
        release({ id: saved.id, state: { current: download.state } });
    } catch (error) {
      $("zoom-status").textContent = error.message;
    } finally {
      if (owned) URL.revokeObjectURL(owned);
      $("convert-save").disabled = false;
    }
  };
  $("close-zoom").onclick = () => $("zoom").close();
  $("zoom").onclick = (event) => {
    if (event.target === $("zoom")) $("zoom").close();
  };
  $("zoom").onclose = () => {
    zoomEpoch++;
    stopVideo();
    $("zoom-image").removeAttribute("src");
  };
  document.addEventListener("keydown", (event) => {
    if (event.target.matches("input,textarea,select,video")) return;
    if ($("zoom").open && ["ArrowLeft", "ArrowRight"].includes(event.key)) {
      event.preventDefault();
      moveZoom(event.key === "ArrowRight" ? 1 : -1);
    } else if (event.key === "/" && !$("zoom").open) {
      event.preventDefault();
      $("search").focus();
    }
  });
  render();
})().catch((error) => {
  const n = document.getElementById("notice");
  n.hidden = false;
  n.textContent = error.message;
});
