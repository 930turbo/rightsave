/* Main-world observer on the named social sites only. No extension privileges.
 * Observe media fields in responses the page itself requested. Never make API requests.
 * Pages can interfere with this bridge; isolated content code validates every item. */
(() => {
  if (globalThis.__rightSavePageBridge) return;
  globalThis.__rightSavePageBridge = true;
  const LIMIT = 2 * 1024 * 1024;
  const domains = ["instagram.com", "facebook.com", "x.com", "twitter.com", "reddit.com", "threads.net", "threads.com", "linkedin.com"];
  const domain = domains.find(d => location.hostname === d || location.hostname.endsWith("." + d)) || location.hostname;
  let enabled = false, route = location.href, epoch = 0, inFlight = 0;
  function responseURL(value, pageURL) {
    try {
      const u = new URL(value, pageURL);
      return (u.hostname === domain || u.hostname.endsWith("." + domain)) && /(?:graphql|\/api\/|\/voyager\/|\.json(?:$|\?))/.test(u.pathname + u.search);
    } catch { return false; }
  }
  function publish(text, requestedRoute, requestedEpoch) {
    if (!enabled || requestedRoute !== location.href || requestedEpoch !== epoch) return;
    if (text && text.length <= LIMIT) window.postMessage({rightsave: "json-v1", pageURL: requestedRoute, text}, location.origin);
  }
  window.addEventListener("message", event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.rightsave !== "config-v1") return;
    const next = event.data.enabled === true;
    if (enabled !== next || route !== location.href) epoch++;
    enabled = next; route = location.href;
  });
  window.postMessage({rightsave: "ready-v1"}, location.origin);
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const requestedRoute = location.href, requestedEpoch = epoch, wasEnabled = enabled;
    const response = await Reflect.apply(originalFetch, this, args);
    try {
      if (enabled && inFlight < 2 && (!wasEnabled || requestedEpoch === epoch) && responseURL(response.url, requestedRoute) && /(?:json|javascript|text\/plain)/i.test(response.headers.get("content-type") || "") && Number(response.headers.get("content-length") || 0) <= LIMIT) {
      const observedEpoch = epoch;
      const clone = response.clone();
      inFlight++;
      void (async () => {
        const parts = []; let length = 0, timer, timedOut = false;
        try {
          const reader = clone.body?.getReader();
          if (!reader) return;
          timer = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => {}); }, 10000);
          while (true) {
            const {done, value} = await reader.read();
            if (done) break;
            length += value.byteLength;
            if (length > LIMIT || !enabled || observedEpoch !== epoch || requestedRoute !== location.href) { void reader.cancel().catch(() => {}); return; }
            parts.push(value);
          }
          const bytes = new Uint8Array(length); let offset = 0;
          for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
          if (!timedOut) publish(new TextDecoder().decode(bytes), requestedRoute, observedEpoch);
        } catch { /* A failed observation never changes the site's response. */ }
        finally { clearTimeout(timer); inFlight--; }
      })();
      }
    } catch { /* Observation setup must not reject the site's successful fetch. */ }
    return response;
  };
  const open = XMLHttpRequest.prototype.open, send = XMLHttpRequest.prototype.send;
  const requests = new WeakMap();
  XMLHttpRequest.prototype.open = function (method, url, ...args) {
    const result = Reflect.apply(open, this, [method, url, ...args]);
    requests.set(this, String(url));
    return result;
  };
  XMLHttpRequest.prototype.send = function (...args) {
    const requestedRoute = location.href, requestedEpoch = epoch, wasEnabled = enabled;
    if (responseURL(requests.get(this), requestedRoute)) this.addEventListener("load", () => {
      if (!enabled || (wasEnabled && requestedEpoch !== epoch) || !responseURL(this.responseURL, requestedRoute)) return;
      try {
        const text = this.responseType === "json" ? JSON.stringify(this.response) : this.responseType === "" || this.responseType === "text" ? this.responseText : "";
        if (text.length <= LIMIT) publish(text, requestedRoute, epoch);
      } catch { /* Unsupported response types and site errors are ignored. */ }
    }, {once: true});
    return Reflect.apply(send, this, args);
  };
})();
