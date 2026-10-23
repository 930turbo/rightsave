/* Shared pure helpers. No libraries or external services. */
globalThis.RightSaveUtil = (() => {
  const stream = /\.(?:m3u8|mpd)(?:$|[?#])/i;
  function usableURL(value, base) {
    if (!value || typeof value !== "string" || !value.trim()) return null;
    try {
      const url = new URL(value, base);
      if (url.username || url.password) return null;
      return /^(https?:|file:|data:|blob:)$/.test(url.protocol)
        ? url.href
        : null;
    } catch {
      return null;
    }
  }
  function issue(item) {
    if (
      item.kind === "video" &&
      (stream.test(item.url) || /mpegurl|dash\+xml/i.test(item.mime || ""))
    ) {
      return "This is a streaming playlist, not a complete video file. RightSave cannot combine its segments.";
    }
    if (item.kind === "video" && item.url.startsWith("blob:")) {
      return "This player uses a temporary video URL. It may contain a segmented or protected stream. RightSave needs a direct video-file URL.";
    }
    return "";
  }
  function filename(item) {
    let name = item.suggestedName || "";
    try {
      const url = new URL(item.url);
      if (!name && /^(https?:|file:)$/.test(url.protocol)) {
        name = decodeURIComponent(url.pathname.split("/").pop());
        if (url.hostname === "pbs.twimg.com") {
          name = name.replace(/:(?:small|medium|large|orig|thumb)$/, "");
          const format = url.searchParams.get("format");
          if (
            !/\.[a-z0-9]{2,6}$/i.test(name) &&
            /^(jpg|jpeg|png|webp|gif|avif)$/.test(format || "")
          )
            name += "." + format;
        }
      }
    } catch {
      /* Use a sensible fallback. */
    }
    if (!name || name.length > 160 || !/\.[a-z0-9]{2,6}$/i.test(name)) {
      const mime = item.mime || /^data:([^;,]+)/.exec(item.url)?.[1] || "";
      const ext = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
        "image/gif": "gif",
        "image/svg+xml": "svg",
        "image/avif": "avif",
        "video/mp4": "mp4",
        "video/webm": "webm",
        "video/ogg": "ogv",
        "application/json": "json",
        "text/csv": "csv",
      }[mime.split(";")[0]];
      // An unknown endpoint keeps an extensionless filename so Firefox can use its response type.
      name = `rightsave-${item.kind}${ext ? "." + ext : ""}`;
    }
    name = name
      .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, "_")
      .replace(/^[. ]+|[. ]+$/g, "");
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))
      name = "_" + name;
    return name || "rightsave-media";
  }
  function cssURLs(value) {
    const urls = [];
    const re =
      /url\(\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^)]*))\s*\)/g;
    for (const match of value.matchAll(re)) {
      urls.push(
        (match[1] ?? match[2] ?? match[3])
          .trim()
          .replace(/\\(["'\\() ])/g, "$1"),
      );
    }
    return urls;
  }
  function randomFilename(item) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    const stem = Array.from(bytes, (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    const mime = String(
      item.mime || /^data:([^;,]+)/.exec(item.url || "")?.[1] || "",
    )
      .split(";")[0]
      .trim()
      .toLowerCase();
    const known = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "image/gif": "gif",
      "image/svg+xml": "svg",
      "image/avif": "avif",
      "image/bmp": "bmp",
      "image/tiff": "tiff",
      "image/heic": "heic",
      "video/mp4": "mp4",
      "video/webm": "webm",
      "video/ogg": "ogv",
      "video/quicktime": "mov",
      "video/x-matroska": "mkv",
      "application/zip": "zip",
      "application/json": "json",
      "text/csv": "csv",
    }[mime];
    // Unrecognized endpoints stay extensionless; the browser can infer the response type.
    const extension =
      known || /\.([a-z0-9]{2,6})$/i.exec(filename(item))?.[1].toLowerCase();
    return stem + (extension ? "." + extension : "");
  }
  function koofrShare(value) {
    try {
      const url = new URL(value);
      if (
        url.hostname !== "app.koofr.net" ||
        url.protocol !== "https:" ||
        url.username ||
        url.password
      )
        return null;
      const id = /^\/links\/([\w-]{4,200})\/?$/.exec(url.pathname)?.[1];
      return id ? { url, id } : null;
    } catch {
      return null;
    }
  }
  function koofrOriginal(value, pageURL, hint = {}) {
    const share = koofrShare(pageURL);
    if (!share || typeof value !== "string" || value.length > 12000)
      return null;
    try {
      const url = new URL(value, pageURL);
      if (url.origin !== share.url.origin || url.username || url.password)
        return null;
      const match =
        /^\/content\/links\/([\w-]+)\/files\/get(?:\/([^/]+))?$/.exec(
          url.pathname,
        );
      if (!match || match[1] !== share.id) return null;
      const path = url.searchParams.get("path");
      if (
        !path ||
        !path.startsWith("/") ||
        path.length > 4000 ||
        /[\x00-\x1f\\]/.test(path) ||
        path.split("/").some((p) => p === "." || p === "..")
      )
        return null;
      const name =
        path === "/"
          ? decodeURIComponent(match[2] || "")
          : path.split("/").pop();
      const extension = /\.([a-z0-9]+)$/i.exec(name)?.[1].toLowerCase();
      const types = {
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        png: "image/png",
        webp: "image/webp",
        gif: "image/gif",
        avif: "image/avif",
        svg: "image/svg+xml",
        bmp: "image/bmp",
        tif: "image/tiff",
        tiff: "image/tiff",
        heic: "image/heic",
        mp4: "video/mp4",
        webm: "video/webm",
        ogv: "video/ogg",
        mov: "video/quicktime",
        mkv: "video/x-matroska",
        m4v: "video/mp4",
      };
      const thumbnail = url.searchParams.has("thumb");
      const mime =
        types[extension] ||
        (!thumbnail && /^(image|video)\//.test(hint.mime || "")
          ? hint.mime
          : "");
      // A thumbnail for an unknown file (PDF, folder, RAW, etc.) is not an original image.
      if (!mime) return null;
      const poster = thumbnail ? url.href : "";
      if (!match[2] && name) url.pathname += "/" + encodeURIComponent(name);
      url.searchParams.delete("thumb");
      url.searchParams.delete("convert");
      url.hash = "";
      return {
        url: url.href,
        pageURL,
        kind: mime.startsWith("video/") ? "video" : "image",
        mime,
        label: name || hint.label || "Shared media",
        suggestedName: name,
        source: "Koofr original",
        poster,
        koofrPath: path,
      };
    } catch {
      return null;
    }
  }
  function koofrFilePath(value, pageURL) {
    const share = koofrShare(pageURL);
    if (!share || typeof value !== "string" || value.length > 12000)
      return null;
    try {
      const url = new URL(value, pageURL);
      const match = /^\/content\/links\/([\w-]+)\/files\/get(?:\/[^/]+)?$/.exec(
        url.pathname,
      );
      const path = url.searchParams.get("path");
      return url.origin === share.url.origin &&
        !url.username &&
        !url.password &&
        match?.[1] === share.id &&
        path?.startsWith("/") &&
        path.length <= 4000 &&
        !/[\x00-\x1f\\]/.test(path) &&
        !path.split("/").some((p) => p === "." || p === "..")
        ? path
        : null;
    } catch {
      return null;
    }
  }
  function downloadReferrer(url, pageURL) {
    try {
      const page = new URL(pageURL),
        media = new URL(url);
      if (
        !/^https?:$/.test(page.protocol) ||
        !/^https?:$/.test(media.protocol) ||
        (page.protocol === "https:" && media.protocol === "http:")
      )
        return "";
      const share = koofrShare(pageURL);
      if (share && koofrOriginal(url, pageURL)) {
        // Share identity is necessary for Koofr. Never copy passwords, tokens or fragments to Referer.
        return page.origin + page.pathname;
      }
      return page.origin + "/";
    } catch {
      return "";
    }
  }
  function publicURL(value) {
    try {
      const url = new URL(value);
      if (!["http:", "https:"].includes(url.protocol)) return "";
      url.search = "";
      url.hash = "";
      url.username = "";
      url.password = "";
      return url.href.slice(0, 2000);
    } catch {
      return "";
    }
  }
  function mediaList(items) {
    if (!Array.isArray(items) || items.length > 1000)
      throw new Error("Export up to 1,000 visible files.");
    const media = items.map((item) => ({
      kind: ["image", "video"].includes(item.kind) ? item.kind : "media",
      label: String(item.label || "").slice(0, 300),
      url: publicURL(item.url),
      pageURL: publicURL(item.pageURL),
      width: Math.max(0, Number(item.width) || 0),
      height: Math.max(0, Number(item.height) || 0),
    }));
    return JSON.stringify(
      {
        created: new Date().toISOString(),
        notice:
          "Links omit credentials, query strings and fragments. Paths and labels may still identify private content. This is a source list, not a restorable download queue.",
        media,
      },
      null,
      2,
    );
  }
  function videoPreviewURL(item, pageURL) {
    if (
      !item ||
      item.kind !== "video" ||
      typeof item.url !== "string" ||
      issue(item)
    )
      return null;
    const url = usableURL(item.url);
    if (url?.startsWith("file:") && !String(pageURL || "").startsWith("file:"))
      return null;
    return url;
  }
  return {
    usableURL,
    issue,
    filename,
    cssURLs,
    randomFilename,
    koofrShare,
    koofrOriginal,
    koofrFilePath,
    downloadReferrer,
    publicURL,
    mediaList,
    videoPreviewURL,
  };
})();
