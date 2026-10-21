/* Small MV3 compatibility layer; no remote code or runtime dependencies. */
globalThis.RS = {
  isFirefox:
    typeof globalThis.browser !== "undefined" &&
    !!globalThis.browser.runtime.getBrowserInfo,
  listen(listener) {
    if (this.isFirefox) browser.runtime.onMessage.addListener(listener);
    else
      chrome.runtime.onMessage.addListener((message, sender, respond) => {
        try {
          const result = listener(message, sender);
          if (result === undefined) return false;
          Promise.resolve(result).then(respond, (error) =>
            respond({ error: error.message }),
          );
          return true;
        } catch (error) {
          respond({ error: error.message });
          return false;
        }
      });
  },
};
if (!globalThis.browser) globalThis.browser = globalThis.chrome;
if (!browser.menus && browser.contextMenus)
  browser.menus = browser.contextMenus;
