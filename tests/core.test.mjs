import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs/promises";
import crypto from "node:crypto";
const shared = await fs.readFile(
  new URL("../extension/shared.js", import.meta.url),
  "utf8",
);
const context = vm.createContext({
  URL,
  Date,
  TextEncoder,
  TextDecoder,
  atob,
  crypto: crypto.webcrypto,
});
vm.runInContext(shared, context);
const U = context.RightSaveUtil;
test("Only downloadable URL schemes are accepted", () => {
  assert.equal(U.usableURL("javascript:alert(1)"), null);
  assert.equal(U.usableURL("", "https://example.org"), null);
  assert.equal(
    U.usableURL("/photo.jpg", "https://example.org"),
    "https://example.org/photo.jpg",
  );
});
test("Unplayable streaming resources are not passed off as complete videos", () => {
  assert.ok(U.issue({ kind: "video", url: "https://example.org/v.m3u8" }));
  assert.ok(U.issue({ kind: "video", url: "blob:example" }));
  assert.equal(
    U.issue({ kind: "video", url: "https://example.org/video.mp4" }),
    "",
  );
});
test("Filename sanitization handles encoded slashes and Windows devices", () => {
  assert.equal(
    U.filename({ kind: "image", url: "https://example.org/CON.png" }),
    "_CON.png",
  );
  assert.equal(
    U.filename({ kind: "image", url: "https://example.org/a%2Fb.jpg" }),
    "a_b.jpg",
  );
});
test("Batch templates never escape the download directory", () => {
  const item = {
    url: "https://example.org/a.png",
    pageURL: "https://example.org",
    kind: "image",
  };
  assert.equal(
    U.templatedFilename(item, "{site}/{name}-{index}.{ext}", 2),
    "example.org/a-002.png",
  );
  for (const template of ["../x.png", "/x.png", "C:/x.png", "a/../x.png"])
    assert.throws(() => U.templatedFilename(item, template));
});

test("URLs with embedded credentials are never treated as downloadable media", () => {
  assert.equal(
    U.usableURL("https://name:password@example.org/photo.png"),
    null,
  );
  assert.equal(U.usableURL("https://name@example.org/photo.png"), null);
});
test("Exported source lists omit credential, query, fragment and local references", () => {
  const result = JSON.parse(
    U.mediaList([
      {
        kind: "image",
        url: "https://name:secret@media.test/photo.png?token=secret#secret",
        pageURL: "https://page.test/post/1?session=secret#secret",
        ref: "secret",
        frameId: 4,
        label: "Photo",
      },
      {
        kind: "image",
        url: "data:image/png;base64,secret",
        pageURL: "file:///Users/private",
      },
    ]),
  );
  assert.equal(result.media[0].url, "https://media.test/photo.png");
  assert.equal(result.media[0].pageURL, "https://page.test/post/1");
  assert.equal(result.media[1].url, "");
  assert.equal(result.media[1].pageURL, "");
  assert.ok(!JSON.stringify(result).includes("secret"));
  assert.equal(result.media[0].ref, undefined);
  assert.throws(() => U.mediaList(Array(1001).fill({})));
});
