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
  function templatedFilename(item, template, index = 1) {
    const original = filename(item);
    const dot = original.lastIndexOf(".");
    const parts = {
      name: dot < 0 ? original : original.slice(0, dot),
      ext: dot < 0 ? "" : original.slice(dot + 1),
      index: String(index).padStart(3, "0"),
      date: new Date().toISOString().slice(0, 10),
      site: "webpage",
    };
    try {
      parts.site = new URL(item.pageURL).hostname || "local";
    } catch {
      /* Fallback */
    }
    if (!template || template.length > 160 || /^[\\/]|^[a-z]:/i.test(template))
      throw new Error(
        "Use a relative filename template, up to 160 characters.",
      );
    const replaced = template.replace(
      /\{(name|ext|index|date|site)\}/g,
      (_, key) => parts[key],
    );
    const segments = replaced.split("/");
    if (
      segments.length > 4 ||
      segments.some((s) => !s.trim() || /^\.+$/.test(s.trim()))
    )
      throw new Error(
        "The template contains an invalid folder or too many folders.",
      );
    return segments
      .map((segment) => {
        let clean = segment
          .replace(/[<>:"\\|?*\u0000-\u001f]/g, "_")
          .replace(/^[. ]+|[. ]+$/g, "");
        if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(clean))
          clean = "_" + clean;
        return clean.slice(0, 180) || "media";
      })
      .join("/");
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
  return {
    usableURL,
    issue,
    filename,
    cssURLs,
    templatedFilename,
    publicURL,
    mediaList,
  };
})();
