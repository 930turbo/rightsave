import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs/promises";
import crypto from "node:crypto";
const source = await fs.readFile(
  new URL("../extension/background.js", import.meta.url),
  "utf8",
);
const shared = await fs.readFile(
  new URL("../extension/shared.js", import.meta.url),
  "utf8",
);
function environment() {
  const event = () => ({
    listeners: [],
    addListener(fn) {
      this.listeners.push(fn);
    },
    removeListener(fn) {
      this.listeners = this.listeners.filter((f) => f !== fn);
    },
    hasListener(fn) {
      return this.listeners.includes(fn);
    },
  });
  const session = {},
    local = { disabledSites: [] },
    calls = [];
  const area = (data) => ({
    get: async (key) =>
      key === null
        ? { ...data }
        : typeof key === "string"
          ? { [key]: data[key] }
          : { ...key, ...data },
    set: async (value) => Object.assign(data, value),
    remove: async (keys) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
    },
  });
  const browser = {
    runtime: {
      id: "test-id",
      getURL: (p) => "moz-extension://extension/" + p,
      onInstalled: event(),
    },
    menus: {
      removeAll: async () => {},
      create() {},
      onShown: event(),
      onHidden: event(),
      onClicked: event(),
    },
    storage: { session: area(session), local: area(local), onChanged: event() },
    tabs: {
      get: async (id) => ({
        id,
        url: "https://excluded.test/post",
        title: "Post",
        windowId: 1,
      }),
      create: async () => ({ id: 42 }),
      onRemoved: event(),
      onUpdated: event(),
    },
    downloads: {
      onChanged: event(),
      search: async () => [],
      download: async (value) => {
        calls.push(value);
        return 1;
      },
    },
    permissions: { onAdded: event(), onRemoved: event() },
    commands: { onCommand: event() },
    webRequest: { onHeadersReceived: event() },
  };
  const context = vm.createContext({
    browser,
    URL,
    crypto: crypto.webcrypto,
    console,
    RS: {
      isFirefox: true,
      listen: (fn) => {
        context.receive = fn;
      },
    },
  });
  vm.runInContext(shared, context);
  vm.runInContext(source, context);
  const observe = () =>
    browser.webRequest.onHeadersReceived.listeners[0]({
      tabId: 1,
      url: "https://media.test/video.mp4?private=signed",
      documentUrl: "https://excluded.test/post",
      responseHeaders: [{ name: "Content-Type", value: "video/mp4" }],
    });
  const flush = async () => await vm.runInContext("networkWrites", context);
  return { browser, context, session, local, calls, observe, flush };
}
test("Webpage senders cannot invoke privileged scan, export, save or billing actions", () => {
  const e = environment();
  for (const type of [
    "browse",
    "save",
    "archive-source",
    "save-archive",
    "export-list",
    "commerce",
  ])
    assert.equal(
      e.context.receive(
        { type },
        { id: "test-id", url: "https://webpage.test/" },
      ),
      undefined,
    );
  assert.equal(
    e.context.receive(
      { type: "save" },
      { id: "other-id", url: "moz-extension://extension/library.html" },
    ),
    undefined,
  );
  assert.equal(e.context.receive(null, {}), undefined);
  assert.equal(e.calls.length, 0);
});
test("Optional video observation respects excluded websites", async () => {
  const e = environment();
  e.local.disabledSites = ["excluded.test"];
  e.observe();
  await e.flush();
  assert.equal(e.session["network:1"], undefined);
  e.local.disabledSites = [];
  e.observe();
  await e.flush();
  assert.equal(e.session["network:1"].length, 1);
});
test("Navigation discards queued response observations", async () => {
  const e = environment();
  e.observe();
  e.browser.tabs.onUpdated.listeners[0](1, { url: "https://other.test/" });
  await e.flush();
  assert.equal(e.session["network:1"], undefined);
});
test("Revoking video observation clears its data after pending writes", async () => {
  const e = environment();
  e.observe();
  await e.browser.permissions.onRemoved.listeners[0]({
    permissions: ["webRequest"],
  });
  assert.equal(e.session["network:1"], undefined);
  assert.equal(e.browser.webRequest.onHeadersReceived.listeners.length, 0);
});
test("Closing a library or source tab removes the corresponding temporary list only", async () => {
  const e = environment();
  e.session["picker:one"] = { tabId: 1, libraryTabId: 42 };
  e.session["picker:two"] = { tabId: 3, libraryTabId: 43 };
  e.session["network:1"] = [{ url: "private" }];
  await e.browser.tabs.onRemoved.listeners[0](42);
  assert.equal(e.session["picker:one"], undefined);
  assert.ok(e.session["picker:two"]);
  await e.browser.tabs.onRemoved.listeners[0](1);
  assert.equal(e.session["network:1"], undefined);
  assert.ok(e.session["picker:two"]);
});
test("Exported list has bounded input and redacted URLs before any download", async () => {
  const e = environment(),
    sender = { id: "test-id", url: "moz-extension://extension/library.html" };
  const result = await e.context.receive(
    {
      type: "export-list",
      tabId: 1,
      items: Array(1001).fill({ url: "https://test/" }),
    },
    sender,
  );
  assert.match(result.error, /1,000/);
  assert.equal(e.calls.length, 0);
});
test("A remote page cannot use the extension to fetch or save local files", async () => {
  const e = environment(),
    sender = { id: "test-id", url: "moz-extension://extension/library.html" };
  for (const type of ["save", "archive-source"]) {
    const result = await e.context.receive(
      {
        type,
        tabId: 1,
        item: { kind: "image", url: "file:///Users/private/photo.png" },
      },
      sender,
    );
    assert.match(result.error, /Local files/);
  }
  assert.equal(e.calls.length, 0);
});
test("Upgrade clears legacy activation data while retaining saved workflows", async () => {
  const e = environment();
  e.local.license = "old";
  e.local.purchaseLicense = { key: "old" };
  e.local.workflowPresets = [{ name: "Keep this" }];
  await e.browser.runtime.onInstalled.listeners[0]({ reason: "update" });
  assert.equal(e.local.license, undefined);
  assert.equal(e.local.purchaseLicense, undefined);
  assert.equal(e.local.workflowPresets.length, 1);
});
