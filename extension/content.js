(() => {
  if (globalThis.__rightSave) return;
  const U = globalThis.RightSaveUtil;
  const S = globalThis.RightSaveSites;
  let enhancedDetection = false;
  let route = location.href,
    dataRevision = 0;
  const pageMedia = new Map(),
    parsedNodes = new WeakMap();
  let restore = true;
  let quickSave = true;
  let quickPending = false;
  let last = null;
  let serial = 0;
  const references = new Map();
  const ids = new WeakMap();
  const host = location.hostname;
  function bridgeConfig() {
    if (!S.site(location.href) || !/^https?:/.test(location.href)) return;
    window.postMessage(
      { rightsave: "config-v1", enabled: enhancedDetection && restore },
      location.origin,
    );
  }
  function checkRoute() {
    if (route === location.href) return;
    route = location.href;
    pageMedia.clear();
    last = null;
    bridgeConfig();
  }
  function remember(items) {
    for (const value of items.slice(0, 300)) {
      const item = S.clean(value, location.href);
      if (!item) continue;
      pageMedia.set(item.kind + ":" + item.url, item);
      if (pageMedia.size > 300) pageMedia.delete(pageMedia.keys().next().value);
    }
  }
  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    if (event.data?.rightsave === "ready-v1") {
      bridgeConfig();
      return;
    }
    if (
      !enhancedDetection ||
      !restore ||
      event.data?.rightsave !== "json-v1" ||
      event.data.pageURL !== location.href ||
      !S.site(location.href) ||
      typeof event.data.text !== "string" ||
      event.data.text.length > 2 * 1024 * 1024
    )
      return;
    checkRoute();
    remember(S.parse(event.data.text, location.href));
  });
  function pageData() {
    checkRoute();
    if (!enhancedDetection || !restore) return [];
    let budget = 4 * 1024 * 1024;
    for (const node of [
      ...document.querySelectorAll(
        'script[type="application/json"],script[type="application/ld+json"],script#__NEXT_DATA__,code[id^="datalet-"]',
      ),
    ].slice(0, 100)) {
      const text = node.textContent;
      if (!text || text.length > 2 * 1024 * 1024 || (budget -= text.length) < 0)
        continue;
      let hash = 2166136261;
      for (let i = 0; i < text.length; i++)
        hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
      const stamp = text.length + ":" + hash;
      const previous = parsedNodes.get(node);
      if (
        previous?.stamp === stamp &&
        (previous.route !== route || previous.revision === dataRevision)
      )
        continue;
      parsedNodes.set(node, { stamp, route, revision: dataRevision });
      remember(S.parse(text, location.href));
    }
    // Open Graph images and actual video files. Embed/player HTML isn't a video.
    const title =
      document.querySelector('meta[property="og:title"]')?.content ||
      document.title;
    for (const node of [
      ...document.querySelectorAll(
        'meta[property^="og:image"],meta[property^="og:video"],meta[name="twitter:image"]',
      ),
    ].slice(0, 40)) {
      const property = node.getAttribute("property") || node.name;
      if (
        !/^(?:og:(?:image|video)(?::(?:url|secure_url))?|twitter:image)$/.test(
          property,
        )
      )
        continue;
      const kind = property.includes("video") ? "video" : "image";
      const mime =
        kind === "video"
          ? document.querySelector('meta[property="og:video:type"]')?.content ||
            ""
          : "";
      if (
        kind === "video" &&
        !/^video\//.test(mime) &&
        !/\.(mp4|webm|ogv)(?:[?#]|$)/i.test(node.content)
      )
        continue;
      const stamp = property + ":" + node.content,
        previous = parsedNodes.get(node);
      if (
        previous?.stamp === stamp &&
        (previous.route !== route || previous.revision === dataRevision)
      )
        continue;
      parsedNodes.set(node, { stamp, route, revision: dataRevision });
      remember([
        {
          url: node.content,
          kind,
          mime,
          source: "Page metadata",
          label: title,
          postURL: S.postKey(location.href) ? location.href : "",
        },
      ]);
    }
    return [...pageMedia.values()];
  }
  function configure(settings) {
    restore = !(settings.disabledSites || []).includes(host);
    quickSave = settings.quickSave !== false;
    enhancedDetection = settings.enhancedDetection !== false;
    bridgeConfig();
  }
  browser.storage.local
    .get(["disabledSites", "quickSave", "enhancedDetection"])
    .then(configure)
    .catch(() => {});
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.disabledSites)
      restore = !(changes.disabledSites.newValue || []).includes(host);
    if (changes.quickSave) quickSave = changes.quickSave.newValue !== false;
    if (changes.enhancedDetection) {
      enhancedDetection = changes.enhancedDetection.newValue !== false;
      dataRevision++;
    }
    if (changes.disabledSites) dataRevision++;
    if (!enhancedDetection || !restore) pageMedia.clear();
    if (changes.disabledSites || changes.enhancedDetection) bridgeConfig();
  });
  function idFor(element) {
    if (!ids.has(element)) ids.set(element, String(++serial));
    const id = ids.get(element);
    references.set(id, element);
    // Keep references bounded; old picker entries can be refreshed if their canvas expires.
    if (references.size > 3000)
      references.delete(references.keys().next().value);
    return id;
  }
  function visible(element) {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return (
      rect.width > 1 &&
      rect.height > 1 &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity) !== 0
    );
  }
  function contains(element, point) {
    const r = element.getBoundingClientRect();
    return (
      point.x >= r.left &&
      point.x <= r.right &&
      point.y >= r.top &&
      point.y <= r.bottom &&
      visible(element)
    );
  }
  function allElements(root = document) {
    const result = [];
    // Full DOM traversal is reserved for an explicit page scan.
    for (const element of root.querySelectorAll("*")) {
      result.push(element);
      if (element.shadowRoot) result.push(...allElements(element.shadowRoot));
    }
    return result;
  }
  function itemsFor(element, backgrounds = true) {
    const items = [];
    const tag = element.localName;
    const rect = element.getBoundingClientRect();
    const common = {
      ref: ["img", "input", "image", "video", "canvas", "svg"].includes(tag)
        ? idFor(element)
        : undefined,
      pageURL: location.href,
      width: Math.round(
        element.naturalWidth ||
          element.videoWidth ||
          (typeof element.width === "number" ? element.width : rect.width),
      ),
      height: Math.round(
        element.naturalHeight ||
          element.videoHeight ||
          (typeof element.height === "number" ? element.height : rect.height),
      ),
      poster: tag === "video" ? element.poster : "",
    };
    const add = (url, kind, source, mime = "", label = "") => {
      const normalized = U.usableURL(url, document.baseURI);
      if (normalized)
        items.push({
          ...common,
          url: normalized,
          kind,
          source,
          mime,
          label: String(label).slice(0, 150),
        });
    };
    if (tag === "img") {
      const original = element.currentSrc || element.src;
      const redditPreview = /^https?:\/\/preview\.redd\.it\//.test(original);
      if (redditPreview) add(original, "image", "Image", "", element.alt);
      for (const url of S.imageVariants(original, location.href))
        add(url, "image", "Original-size candidate", "", element.alt);
      if (!redditPreview) add(original, "image", "Image", "", element.alt);
    }
    if (tag === "img") {
      for (const attr of [
        "data-src",
        "data-original",
        "data-lazy-src",
        "data-full",
        "data-large_image",
      ]) {
        if (element.getAttribute(attr))
          add(
            element.getAttribute(attr),
            "image",
            "Lazy/original image",
            "",
            element.alt,
          );
      }
      for (const match of (element.getAttribute("srcset") || "").matchAll(
        /(?:^|,)\s*(?!data:)(\S+)\s+(\d+(?:\.\d+)?[wx])(?=\s*(?:,|$))/g,
      )) {
        add(
          match[1],
          "image",
          `Responsive image (${match[2]})`,
          "",
          element.alt,
        );
      }
      const link = element.closest("a[href]");
      if (
        link &&
        /\.(?:png|jpe?g|gif|webp|avif|svg)(?:[?#]|$)/i.test(link.href)
      )
        add(link.href, "image", "Linked original", "", element.alt);
    }
    if (tag === "input" && element.type === "image")
      add(element.src, "image", "Image button");
    if (
      tag === "image" &&
      element.namespaceURI === "http://www.w3.org/2000/svg"
    )
      add(element.href.baseVal, "image", "SVG image");
    if (tag === "video") {
      const selected = element.currentSrc || element.src;
      const sources = [...element.querySelectorAll("source[src]")];
      if (selected)
        add(
          selected,
          "video",
          "Video",
          sources.find((source) => source.src === selected)?.type || "",
        );
      for (const source of element.querySelectorAll("source[src]"))
        add(source.src, "video", "Video source", source.type);
      if (!items.length)
        items.push({
          ...common,
          url: "blob:unavailable",
          kind: "video",
          source: "Video player",
          mime: "",
          label: "No direct video file exposed",
        });
      if (element.poster) add(element.poster, "image", "Video poster");
    }
    if (tag === "canvas")
      items.push({
        ...common,
        url: `canvas:${common.ref}`,
        kind: "image",
        source: "Canvas",
        mime: "image/png",
        label: "Save visible canvas as PNG",
      });
    if (tag === "svg")
      items.push({
        ...common,
        url: `svg:${common.ref}`,
        kind: "image",
        source: "Inline SVG",
        mime: "image/svg+xml",
        label: element.getAttribute("aria-label") || "Vector image",
      });
    if (backgrounds) {
      for (const pseudo of [null, "::before", "::after"]) {
        const style = getComputedStyle(element, pseudo);
        if (pseudo && (style.content === "none" || style.content === "normal"))
          continue;
        for (const url of U.cssURLs(style.backgroundImage))
          add(
            url,
            "image",
            pseudo ? "Decorative background" : "Background image",
          );
      }
    }
    return items;
  }
  function unique(items) {
    const seen = new Set();
    return items
      .filter((item) => {
        const key = item.kind + " " + item.url;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 1000);
  }
  function detect(point, path = []) {
    const stack = document.elementsFromPoint(point.x, point.y);
    const direct = [
      ...new Set([...path.filter((e) => e instanceof Element), ...stack]),
    ];
    let media = direct.flatMap((e) => itemsFor(e, false));
    // An ordinary image/video click needs no DOM search. Only use a targeted media
    // search when an overlay/pointer-events:none hides the actual media from hit testing.
    if (!media.length) {
      const roots = new Set([document]);
      for (const element of direct) {
        if (element.shadowRoot) roots.add(element.shadowRoot);
        roots.add(element.getRootNode());
      }
      const nearby = [];
      for (const root of roots) {
        for (const element of root.querySelectorAll(
          "img,video,canvas,svg,input[type=image],image",
        )) {
          if (contains(element, point)) nearby.push(element);
        }
      }
      media = nearby.flatMap((e) => itemsFor(e, false));
    }
    // Match by the clicked media's poster, URL, or nearest post permalink.
    // Never substitute an unrelated video just because it is the only cached one.
    const cached = pageData(),
      resolved = [];
    for (const item of media) {
      const element = references.get(item.ref) || direct[0];
      const container = element?.closest(
        'article,[role="article"],shreddit-post,[data-testid="tweet"]',
      );
      const links = container
        ? [...container.querySelectorAll("a[href]")]
            .slice(0, 60)
            .map((a) => a.href)
        : [];
      resolved.push(
        ...S.related(cached, item, links, location.href).map((candidate) => ({
          ...candidate,
          ref: item.ref,
        })),
        item,
      );
    }
    return unique([...resolved, ...direct.flatMap((e) => itemsFor(e, true))]);
  }
  function onContext(event) {
    if (!event.isTrusted) return;
    if (restore && !event.altKey) event.stopImmediatePropagation();
    const target = event.composedPath().find((e) => e instanceof Element);
    let point = { x: event.clientX, y: event.clientY };
    if (!point.x && !point.y && target) {
      const rect = target.getBoundingClientRect();
      point = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }
    last = {
      items: detect(point, event.composedPath()),
      target,
      path: event.composedPath(),
      time: Date.now(),
    };
    if (
      restore &&
      quickSave &&
      !event.altKey &&
      !event.shiftKey &&
      last.items.length
    ) {
      // One right-click opens Firefox's native location/filename dialog. Suppress
      // the context menu so it cannot also trigger a native Save Image action.
      event.preventDefault();
      if (quickPending) return;
      const videos = last.items.filter((item) => item.kind === "video");
      const item =
        videos.find((item) => !U.issue(item)) || videos[0] || last.items[0];
      quickPending = true;
      browser.runtime
        .sendMessage({ type: "quick-save", item })
        .catch(console.error)
        .finally(() => {
          quickPending = false;
        });
    }
  }
  window.addEventListener("contextmenu", onContext, true);
  for (const type of [
    "pointerdown",
    "pointerup",
    "mousedown",
    "mouseup",
    "auxclick",
  ]) {
    window.addEventListener(
      type,
      (event) => {
        if (event.isTrusted && restore && !event.altKey && event.button === 2)
          event.stopImmediatePropagation();
      },
      true,
    );
  }
  function context(targetElementId) {
    checkRoute();
    const target =
      targetElementId && browser.menus?.getTargetElement
        ? browser.menus.getTargetElement(targetElementId)
        : null;
    if (
      last &&
      Date.now() - last.time < 120000 &&
      (!target || last.path.includes(target))
    )
      return last.items;
    if (!target) return [];
    const r = target.getBoundingClientRect();
    return detect({ x: r.left + r.width / 2, y: r.top + r.height / 2 }, [
      target,
    ]);
  }
  function collect() {
    const cached = pageData();
    return {
      items: unique([
        ...allElements()
          .filter(visible)
          .flatMap((e) => itemsFor(e)),
        ...cached,
      ]),
      title: document.title,
      pageURL: location.href,
    };
  }
  RS.listen((message) => {
    if (message.type === "context")
      return Promise.resolve(context(message.targetElementId));
    if (message.type === "blob-image")
      return (async () => {
        try {
          if (!message.url.startsWith("blob:"))
            throw new Error("Invalid temporary image URL.");
          const response = await fetch(message.url);
          const blob = await response.blob();
          if (!blob.type.startsWith("image/"))
            throw new Error(
              "This temporary URL does not expose an image file.",
            );
          if (blob.size > 40 * 1024 * 1024)
            throw new Error(
              "This temporary image is too large to transfer. Try the website's own download button.",
            );
          const url = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
          return { url };
        } catch {
          return {
            error:
              "This temporary image is no longer accessible or cannot be exported. Reload the webpage and try again, or use its own download button.",
          };
        }
      })();
    if (["canvas", "svg", "video-frame", "thumbnail"].includes(message.type)) {
      try {
        const element = references.get(message.ref);
        if (!element?.isConnected)
          throw new Error("This media changed. Rescan the page and try again.");
        if (message.type === "svg") {
          if (element.localName !== "svg")
            throw new Error("This vector image changed.");
          const clone = element.cloneNode(true);
          clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
          clone
            .querySelectorAll(
              "script,foreignObject,iframe,object,embed,link,style,animate,animateMotion,animateTransform,set,discard,audio,video",
            )
            .forEach((e) => e.remove());
          for (const e of [clone, ...clone.querySelectorAll("*")]) {
            if (e.namespaceURI !== "http://www.w3.org/2000/svg") {
              e.remove();
              continue;
            }
            for (const attr of [...e.attributes]) {
              if (attr.namespaceURI === "http://www.w3.org/2000/xmlns/")
                continue;
              const name = attr.localName.toLowerCase(),
                value = attr.value;
              const link = ["href", "src"].includes(name);
              const externalURL = U.cssURLs(value).some(
                (url) => !/^#[\w:.-]+$/.test(url),
              );
              if (
                /^on/i.test(name) ||
                ["style", "base"].includes(name) ||
                (link && !/^#[\w:.-]+$/.test(value)) ||
                externalURL ||
                /[\\]|(?:javascript|data|https?|file|blob):|\/\//i.test(value)
              )
                e.removeAttribute(attr.name);
            }
          }
          return Promise.resolve({
            url:
              "data:image/svg+xml;charset=utf-8," +
              encodeURIComponent(new XMLSerializer().serializeToString(clone)),
          });
        }
        let canvas = element;
        if (
          message.type === "video-frame" ||
          (message.type === "thumbnail" && element.localName !== "canvas")
        ) {
          if (
            element.localName === "video" &&
            (element.mediaKeys || !element.videoWidth || element.readyState < 2)
          )
            throw new Error(
              "Play an unprotected video first to capture its current frame.",
            );
          if (!["video", "img"].includes(element.localName))
            throw new Error("Preview unavailable for this media.");
          canvas = document.createElement("canvas");
          const width = element.videoWidth || element.naturalWidth;
          const height = element.videoHeight || element.naturalHeight;
          const scale =
            message.type === "thumbnail"
              ? Math.min(1, 640 / width, 420 / height)
              : 1;
          canvas.width = Math.round(width * scale);
          canvas.height = Math.round(height * scale);
          canvas
            .getContext("2d")
            .drawImage(element, 0, 0, canvas.width, canvas.height);
        }
        if (canvas.localName !== "canvas")
          throw new Error("This media cannot be exported.");
        const url = canvas.toDataURL("image/png");
        if (url === "data:,")
          throw new Error("This canvas is empty or too large to save.");
        return Promise.resolve({ url });
      } catch (error) {
        return Promise.resolve({
          error:
            error.name === "SecurityError"
              ? "The browser blocks exporting this canvas because it contains images from another origin."
              : error.message,
        });
      }
    }
  });
  globalThis.__rightSave = { collect };
})();
