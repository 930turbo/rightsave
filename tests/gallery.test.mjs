import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs/promises";
import crypto from "node:crypto";
const ctx = vm.createContext({
  URL,
  Set,
  Uint8Array,
  crypto: crypto.webcrypto,
  RightSaveUtil: { filename: (item) => item.label || item.url },
});
vm.runInContext(
  await fs.readFile(
    new URL("../extension/gallery.js", import.meta.url),
    "utf8",
  ),
  ctx,
);
const G = ctx.RightSaveGallery;
const media = [
  {
    url: "https://a.test/one.jpg?sig=keep",
    kind: "image",
    label: "Ocean",
    width: 1200,
    height: 800,
  },
  {
    url: "https://a.test/two.png",
    kind: "image",
    label: "Portrait",
    width: 600,
    height: 900,
  },
  {
    url: "https://a.test/three.webp",
    kind: "image",
    label: "Square",
    width: 800,
    height: 800,
  },
  {
    url: "https://a.test/movie.mp4",
    kind: "video",
    label: "Video",
    width: 1920,
    height: 1080,
  },
  { url: "https://a.test/unknown", kind: "image", label: "Unknown" },
];
test("Formats use real extensions, MIME aliases and image format parameters", () => {
  assert.equal(G.format(media[0]), "jpg");
  assert.equal(
    G.format({ mime: "image/jpeg", url: "https://a.test/x" }),
    "jpg",
  );
  assert.equal(
    G.format({ url: "https://pbs.twimg.com/media/x?format=png&name=orig" }),
    "png",
  );
  assert.equal(G.format({ url: "svg:1" }), "svg");
  assert.equal(G.format({ url: "canvas:1" }), "png");
});
test("Format, shape and width filters combine without changing signed URLs", () => {
  const result = G.filter(media, {
    kind: "image",
    format: "jpg",
    orientation: "landscape",
    minWidth: 1000,
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].url, media[0].url);
  assert.equal(media.length, 5);
});
test("Unknown dimensions are excluded from shape and minimum width filters", () => {
  assert.equal(G.filter(media, { orientation: "portrait" }).length, 1);
  assert.equal(G.filter(media, { orientation: "square" }).length, 1);
  assert.equal(G.filter(media, { minWidth: 1000 }).length, 2);
});
test("Repeated-link hiding compares exact URL and kind, preserving signed variants", () => {
  const items = [
    media[0],
    { ...media[0], frameId: 2 },
    { ...media[0], url: media[0].url + "&variant=2" },
  ];
  assert.equal(G.filter(items, { unique: true }).length, 2);
  assert.equal(G.filter(items).length, 3);
});
test("Known unsigned X size variants group to the largest candidate without rewriting its URL", () => {
  const small = {
      url: "https://pbs.twimg.com/media/abc?format=jpg&name=small",
      kind: "image",
      width: 400,
      height: 300,
    },
    large = {
      ...small,
      url: "https://pbs.twimg.com/media/abc?format=jpg&name=orig",
      width: 1600,
      height: 1200,
    };
  const result = G.filter([small, large], { unique: true });
  assert.equal(result.length, 1);
  assert.equal(result[0].url, large.url);
  assert.equal(
    G.filter(
      [
        { ...small, url: small.url + "&sig=a" },
        { ...large, url: large.url + "&sig=b" },
      ],
      { unique: true },
    ).length,
    2,
  );
});
test("Search and sort operate on a copied list", () => {
  assert.equal(G.filter(media, { query: "ocean" })[0].label, "Ocean");
  assert.equal(G.filter(media, { sort: "largest" })[0].label, "Video");
  assert.equal(media[0].label, "Ocean");
});
test("Exact-file duplicate hashing distinguishes bytes, not filenames or CRC collisions", async () => {
  const a = await G.digest(new TextEncoder().encode("abc"));
  assert.equal(
    a,
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  assert.notEqual(a, await G.digest(new TextEncoder().encode("abd")));
});
