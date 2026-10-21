import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs/promises";
import { spawnSync } from "node:child_process";
const source = await fs.readFile(
  new URL("../extension/collections.js", import.meta.url),
  "utf8",
);
const store = {};
const context = vm.createContext({
  URL,
  Map,
  Uint8Array,
  Uint32Array,
  DataView,
  TextEncoder,
  Blob,
  Date,
  fetch,
  browser: {
    storage: {
      local: {
        get: async () => store,
        set: async (v) => Object.assign(store, v),
      },
    },
  },
});
vm.runInContext(
  await fs.readFile(new URL("../extension/shared.js", import.meta.url), "utf8"),
  context,
);
vm.runInContext(source, context);
const P = context.RightSaveCollections;
const valid = {
  name: "Product references",
  template: "{site}/{name}-{index}.{ext}",
  search: "photo",
  minWidth: 800,
  filter: "image",
  sort: "largest",
  size: "xl",
};
test("ZIP round-trips through an independent reader with UTF-8, folders and duplicate names", async () => {
  const zip = new P.Zip();
  zip.add("photos/café.png", new Uint8Array([1, 2, 3]));
  zip.add("photos/café.png", new Uint8Array([4, 5]));
  const bytes = new Uint8Array(await zip.blob().arrayBuffer());
  const python = spawnSync(
    process.platform === "win32" ? "python" : "python3",
    [
      "-c",
      "import io,sys,zipfile; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); assert z.testzip() is None; assert z.namelist()==['photos/café.png','photos/café (2).png']; assert z.read(z.namelist()[0])==bytes([1,2,3]); assert z.read(z.namelist()[1])==bytes([4,5])",
    ],
    { input: bytes },
  );
  assert.equal(python.status, 0, python.stderr.toString());
});
test("ZIP rejects traversal and enforces count and per-file limits", () => {
  for (const path of ["../x", "/x", "C:/x", "a/../x", "a\\x"])
    assert.throws(() => new P.Zip().add(path, new Uint8Array([1])));
  const zip = new P.Zip();
  for (let i = 0; i < 100; i++) zip.add(String(i), new Uint8Array([i]));
  assert.throws(() => zip.add("101", new Uint8Array([1])));
  assert.throws(() => new P.Zip().add("big", new Uint8Array(P.MAX_FILE + 1)));
});
test("CRC32 matches the standard check vector", () =>
  assert.equal(P.crc32(new TextEncoder().encode("123456789")), 0xcbf43926));
test("Workflow presets validate, persist, replace, load and delete", async () => {
  await P.savePreset(valid);
  assert.equal((await P.presets())[0].minWidth, 800);
  await P.savePreset({ ...valid, minWidth: 1200 });
  assert.equal((await P.presets()).length, 1);
  assert.equal((await P.presets())[0].minWidth, 1200);
  await P.removePreset(valid.name);
  assert.equal((await P.presets()).length, 0);
  for (const bad of [
    { ...valid, name: "" },
    { ...valid, minWidth: 20001 },
    { ...valid, size: "huge" },
  ])
    assert.throws(() => P.preset(bad));
});
test("Workflow packs round-trip allowlisted fields and reject malformed imports atomically", async () => {
  await P.savePreset(valid);
  const pack = await P.exportPack();
  store.workflowPresets = [];
  assert.equal(await P.importPack(pack), 1);
  assert.equal((await P.presets())[0].name, valid.name);
  const before = JSON.stringify(store);
  await assert.rejects(() =>
    P.importPack(
      JSON.stringify({
        product: "rightsave",
        version: 1,
        workflows: [valid, { ...valid, size: "unknown" }],
      }),
    ),
  );
  assert.equal(JSON.stringify(store), before);
  await P.importPack(
    JSON.stringify({
      product: "rightsave",
      version: 1,
      workflows: [{ ...valid, name: "Shared", injected: "discard" }],
    }),
  );
  assert.equal(store.workflowPresets[1].injected, undefined);
});
test("Source records preserve actual archive names, redact signed queries and neutralize spreadsheet formulas", () => {
  const records = P.sourceRecords([
    {
      filename: "images/photo (2).png",
      bytes: 12,
      item: {
        label: '=HYPERLINK("evil")',
        url: "https://media.test/photo.png?token=private",
        pageURL: "https://social.test/post/1?secret=private#fragment",
        width: 900,
        height: 600,
      },
    },
  ]);
  assert.ok(!records.json.includes("private"));
  assert.ok(records.csv.includes("'=HYPERLINK"));
  const data = JSON.parse(records.json);
  assert.equal(data.files[0].filename, "images/photo (2).png");
  assert.equal(data.files[0].page, "https://social.test/post/1");
  assert.throws(() => P.sourceRecords(Array(99).fill({})));
});
