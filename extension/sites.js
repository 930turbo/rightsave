/* Bounded, pure media-data adapters. Page data is untrusted; never execute it. */
globalThis.RightSaveSites = (() => {
  const definitions = [
    ["instagram.com", "Instagram"], ["facebook.com", "Facebook"],
    ["x.com", "X"], ["twitter.com", "X"], ["reddit.com", "Reddit"],
    ["threads.net", "Threads"], ["threads.com", "Threads"], ["linkedin.com", "LinkedIn"]
  ];
  const LIMIT = 300;
  function site(value) {
    try {
      const host = new URL(value).hostname.toLowerCase();
      return definitions.find(([domain]) => host === domain || host.endsWith("." + domain))?.[1] || "";
    } catch { return ""; }
  }
  function http(value, base) {
    if (typeof value !== "string" || !value.trim() || value.length > 12000) return "";
    try {
      const u = new URL(value.replace(/&amp;/g, "&"), base);
      return /^https?:$/.test(u.protocol) && !u.username && !u.password ? u.href : "";
    } catch { return ""; }
  }
  function number(value) { return Math.min(100000, Math.max(0, Number(value) || 0)); }
  function clean(item, pageURL) {
    const url = http(item?.url, pageURL);
    if (!url || !["image", "video"].includes(item.kind)) return null;
    return {
      url, kind: item.kind, pageURL,
      source: String(item.source || "Page media data").slice(0, 100),
      mime: String(item.mime || "").slice(0, 80),
      label: String(item.label || "").slice(0, 150),
      width: number(item.width), height: number(item.height),
      bitrate: Math.min(1000000000, number(item.bitrate / 1000) * 1000),
      poster: http(item.poster, pageURL), postURL: http(item.postURL, pageURL),
      audio: ["separate", "none"].includes(item.audio) ? item.audio : "unknown"
    };
  }
  function extract(data, pageURL) {
    const name = site(pageURL) || "Website";
    const result = new Map(), seen = new Set();
    let visited = 0;
    function add(value, kind, node, context, extra = {}) {
      const item = clean({url: value, kind, source: name + " page data", mime: kind === "video" ? "video/mp4" : "",
        width: node.width || node.original_width, height: node.height || node.original_height,
        poster: context.poster, postURL: context.postURL, label: context.label,
        ...extra}, pageURL);
      if (!item) return;
      if (kind === "video" && /\.webm(?:[?#]|$)/i.test(item.url)) item.mime = "video/webm";
      if (/\.(?:m3u8|mpd)(?:[?#]|$)/i.test(item.url)) item.mime = /\.mpd/i.test(item.url) ? "application/dash+xml" : "application/vnd.apple.mpegurl";
      const key = kind + ":" + item.url, old = result.get(key);
      if (!old || item.width * item.height > old.width * old.height) result.set(key, item);
    }
    function walk(node, inherited = {}, depth = 0) {
      if (!node || typeof node !== "object" || depth > 32 || ++visited > 20000 || result.size >= LIMIT || seen.has(node)) return;
      seen.add(node);
      if (Array.isArray(node)) { for (const value of node.slice(0, 1500)) walk(value, inherited, depth + 1); return; }
      const context = {...inherited};
      const title = node.accessibility_caption || node.full_text || node.title || node.caption?.text || node.name;
      if (typeof title === "string" && !/^t[13]_/.test(title)) context.label = title.slice(0, 150);
      const poster = node.display_url || node.thumbnail_src || node.media_url_https || node.thumbnailUrl || node.thumbnail_url || node.poster || node.preview_image_url;
      if (typeof poster === "string") context.poster = http(poster, pageURL);
      if (name === "X" && (node.full_text || node.legacy?.full_text)) {
        const id = node.rest_id || node.id_str || node.legacy?.id_str;
        if (/^\d+$/.test(String(id))) context.postURL = `https://x.com/i/status/${id}`;
      }
      if ((name === "Instagram" || name === "Threads") && typeof node.code === "string" && /^[\w-]{3,80}$/.test(node.code)) {
        context.postURL = name === "Instagram" ? `https://www.instagram.com/p/${node.code}/` : `https://www.threads.net/@_/post/${node.code}`;
      }
      if (name === "Reddit" && typeof node.permalink === "string") context.postURL = http(node.permalink, "https://www.reddit.com");
      if (name === "LinkedIn" && typeof node.entityUrn === "string") {
        const match = /urn:li:activity:\d+/.exec(node.entityUrn);
        if (match) context.postURL = `https://www.linkedin.com/feed/update/${match[0]}/`;
      }
      if (node.is_drm || node.isDrmProtected || node.drmInfo || node.encrypted === true) return;
      for (const key of ["videoDeliveryResponseResult", "videoDeliveryResponseFragment"]) {
        if (typeof node[key] === "string" && node[key].length <= 2 * 1024 * 1024) {
          try { walk(JSON.parse(node[key]), context, depth + 1); } catch { /* Not JSON. */ }
        }
      }
      for (const key of ["video_url", "playable_url", "playable_url_quality_hd", "browser_native_sd_url", "browser_native_hd_url", "downloadable_url", "playableUrl", "progressive_url"]) {
        if (typeof node[key] === "string") add(node[key], "video", node, context, {height: /(?:_hd_|_hd$)/.test(key) ? (node.height || 720) : node.height});
      }
      // Instagram + Threads: carousel items and progressive video versions.
      if (Array.isArray(node.video_versions)) for (const v of node.video_versions.slice(0, 40)) add(v.url, "video", v, context);
      if (Array.isArray(node.image_versions2?.candidates)) for (const image of node.image_versions2.candidates.slice(0, 40)) add(image.url, "image", image, context);
      for (const key of ["display_url", "display_src", "media_url_https"]) if (typeof node[key] === "string") add(node[key], "image", node, context);
      if (node.original_info && node.media_url_https) add(node.media_url_https, "image", node.original_info, context);
      // X: choose progressive MP4 variants, retaining available resolutions.
      if (Array.isArray(node.video_info?.variants)) for (const v of node.video_info.variants.slice(0, 40)) {
        if (v.content_type !== "video/mp4") continue;
        const size = /\/(\d+)x(\d+)\//.exec(v.url || "");
        add(v.url, "video", node.original_info || node, context, {mime: v.content_type, bitrate: v.bitrate,
          width: size ? Number(size[1]) : node.original_info?.width, height: size ? Number(size[2]) : node.original_info?.height});
      }
      // Reddit's fallback MP4 is commonly video-only. Never claim merged audio.
      if (typeof node.fallback_url === "string") add(node.fallback_url, "video", node, context,
        {audio: node.has_audio === false || node.is_gif === true ? "none" : "separate"});
      for (const key of ["hls_url", "dash_url"]) if (typeof node[key] === "string") add(node[key], "video", node, context);
      if (name === "Reddit" && node.e === "Image" && node.s?.u) add(node.s.u, "image", {width: node.s.x, height: node.s.y}, context);
      if (name === "Reddit" && node.source?.url && node.source.width && node.source.height) add(node.source.url, "image", node.source, context);
      if (name === "Reddit" && node.e === "AnimatedImage") {
        if (node.s?.gif) add(node.s.gif, "image", {width: node.s.x, height: node.s.y}, context, {mime: "image/gif"});
        if (node.s?.mp4) add(node.s.mp4, "video", {width: node.s.x, height: node.s.y}, context, {audio: "none"});
      }
      // LinkedIn: progressiveStreams -> streamingLocations, plus still-image vectors.
      if (Array.isArray(node.progressiveStreams)) for (const stream of node.progressiveStreams.slice(0, 40)) {
        for (const location of (stream.streamingLocations || []).slice(0, 10)) add(location.url, "video", stream, context);
      }
      if (typeof node.rootUrl === "string" && Array.isArray(node.artifacts)) for (const image of node.artifacts.slice(0, 40)) {
        if (typeof image.fileIdentifyingUrlPathSegment === "string") add(node.rootUrl + image.fileIdentifyingUrlPathSegment, "image", image, context);
      }
      // JSON-LD VideoObject / ImageObject is also useful on publisher pages.
      const type = node["@type"];
      if (type === "VideoObject" && node.contentUrl) add(node.contentUrl, "video", node, context, {poster: Array.isArray(node.thumbnailUrl) ? node.thumbnailUrl[0] : node.thumbnailUrl});
      if (type === "ImageObject" && (node.contentUrl || node.url)) add(node.contentUrl || node.url, "image", node, context);
      for (const value of Object.values(node)) if (value && typeof value === "object") walk(value, context, depth + 1);
    }
    walk(data);
    return [...result.values()].slice(0, LIMIT);
  }
  function parse(text, pageURL) {
    if (typeof text !== "string" || text.length > 2 * 1024 * 1024) return [];
    const raw = text.replace(/^\s*(?:for\s*\(;;\);|\)\]\}',?)\s*/, "").trim();
    try { return extract(JSON.parse(raw), pageURL); }
    catch {
      const items = [];
      for (const line of raw.split("\n").slice(0, 100)) {
        try { items.push(...extract(JSON.parse(line), pageURL)); } catch { /* Not JSON; never evaluate JS. */ }
        if (items.length >= LIMIT) break;
      }
      return items.slice(0, LIMIT);
    }
  }
  function imageVariants(value, pageURL) {
    const original = http(value, pageURL);
    if (!original) return [];
    const url = new URL(original);
    // Only rewrite known unsigned thumbnail services. Never strip Meta/LinkedIn signatures.
    if (url.hostname === "pbs.twimg.com" && /^\/media\//.test(url.pathname)) {
      url.pathname = url.pathname.replace(/:(?:small|medium|large|orig|thumb)$/, "");
      url.searchParams.set("name", "orig");
      return url.href === original ? [] : [url.href];
    }
    if (url.hostname === "preview.redd.it" && /\.(?:jpe?g|png|webp|gif)$/i.test(url.pathname)) {
      return ["https://i.redd.it" + url.pathname];
    }
    return [];
  }
  function identity(value) {
    try {
      const url = new URL(value);
      return url.hostname + url.pathname.replace(/:(?:small|medium|large|orig|thumb)$/, "");
    } catch { return ""; }
  }
  function postKey(value) {
    try {
      const url = new URL(value), name = site(value);
      if (name === "X") return /\/status\/(\d+)/.exec(url.pathname)?.[1] || "";
      if (name === "Instagram") return /\/(?:p|reel|reels|tv)\/([\w-]+)/.exec(url.pathname)?.[1] || "";
      if (name === "Threads") return /\/post\/([\w-]+)/.exec(url.pathname)?.[1] || "";
      if (name === "Reddit") return /\/comments\/([\w]+)/.exec(url.pathname)?.[1] || "";
      if (name === "Facebook") return url.searchParams.get("v") || /\/(?:videos|reel)\/(\d+)/.exec(url.pathname)?.[1] || "";
      if (name === "LinkedIn") return /(?:activity[:\-]|ugcPost-)(\d+)/.exec(decodeURIComponent(url.href))?.[1] || "";
    } catch { /* No associated post. */ }
    return "";
  }
  function rank(items) {
    return [...items].sort((a, b) => {
      const ready = i => !/\.(?:m3u8|mpd)(?:[?#]|$)/i.test(i.url) && !/mpegurl|dash\+xml/i.test(i.mime || "");
      return Number(ready(b)) - Number(ready(a)) || (b.height || 0) - (a.height || 0) || (b.bitrate || 0) - (a.bitrate || 0) || (b.width || 0) - (a.width || 0);
    });
  }
  function related(items, target, links = [], pageURL = "") {
    const keys = new Set([...links, pageURL].map(postKey).filter(Boolean));
    const poster = identity(target.poster || ""), media = identity(target.url || "");
    const candidates = items.filter(item => item.kind === target.kind);
    if (target.kind === "video" && poster) {
      const matched = candidates.filter(item => identity(item.poster) === poster);
      if (matched.length) return rank(matched);
    }
    const exact = media ? candidates.filter(item => identity(item.url) === media) : [];
    if (exact.length || target.kind === "image") return rank(exact);
    const matched = candidates.filter(item => postKey(item.postURL) && keys.has(postKey(item.postURL)));
    // Quoted posts can put several permalinks in one article. Ask for a choice
    // rather than letting a higher-resolution unrelated video win.
    return new Set(matched.map(item => postKey(item.postURL))).size === 1 ? rank(matched) : [];
  }
  function responseURL(value, pageURL) {
    if (!site(pageURL)) return false;
    try {
      const url = new URL(value, pageURL);
      return site(url.href) === site(pageURL) && /(?:graphql|\/api\/|\/voyager\/|\.json(?:$|\?))/.test(url.pathname + url.search);
    } catch { return false; }
  }
  return {site, clean, extract, parse, imageVariants, related, rank, responseURL, identity, postKey};
})();
