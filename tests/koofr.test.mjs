import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs/promises";
import crypto from "node:crypto";
const context = vm.createContext({ URL, crypto: crypto.webcrypto });
for (const file of ["shared.js", "sites.js"])
  vm.runInContext(
    await fs.readFile(new URL("../extension/" + file, import.meta.url), "utf8"),
    context,
  );
const U = context.RightSaveUtil,
  S = context.RightSaveSites;
const page = "https://app.koofr.net/links/Share123?path=%2Ffolder#private";
const content =
  "https://app.koofr.net/content/links/Share123/files/get?path=%2Ffolder%2Fphoto.png&password=already-entered&thumb=huge";
test("Koofr thumbnails resolve to originals without losing the access parameter", () => {
  const item = U.koofrOriginal(content, page);
  assert.equal(item.kind, "image");
  assert.equal(item.mime, "image/png");
  const url = new URL(item.url);
  assert.equal(url.searchParams.has("thumb"), false);
  assert.equal(url.searchParams.get("password"), "already-entered");
  assert.equal(item.poster, content);
  assert.equal(item.label, "photo.png");
  assert.match(U.randomFilename(item), /^[a-f0-9]{32}\.png$/);
});
test("Koofr video posters identify the video, not a JPEG preview", () => {
  const item = U.koofrOriginal(content.replace("photo.png", "clip.mp4"), page);
  assert.equal(item.kind, "video");
  assert.equal(item.mime, "video/mp4");
  assert.match(U.randomFilename(item), /^[a-f0-9]{32}\.mp4$/);
});
test("Koofr accepts only this share on the official HTTPS origin", () => {
  for (const url of [
    content.replace("Share123", "Other123"),
    content.replace("app.koofr.net", "app.koofr.net.evil.test"),
    content.replace("https:", "http:"),
    content.replace("app.koofr.net", "name:secret@app.koofr.net"),
    content.replace("photo.png", "..%2Fprivate.png"),
  ])
    assert.equal(U.koofrOriginal(url, page), null);
  assert.equal(
    U.koofrOriginal(
      content,
      page.replace("app.koofr.net", "evil.app.koofr.net"),
    ),
    null,
  );
  assert.equal(
    U.koofrOriginal(content.replace("photo.png", "document.pdf"), page),
    null,
  );
});
test("Koofr file metadata is allowlisted and scoped to the observed public API request", () => {
  const request =
    "https://app.koofr.net/api/v2/public/links/Share123/bundle?path=%2Ffolder&password=allowed";
  const data = {
    file: { type: "dir", name: "folder" },
    files: [
      {
        type: "file",
        name: "photo.png",
        contentType: "image/png",
        secret: "DO_NOT_COPY",
      },
      { type: "file", name: "clip.webm", contentType: "video/webm" },
      { type: "file", name: "../escape.png" },
      { type: "dir", name: "subfolder" },
    ],
  };
  const items = S.koofrData(data, page, request);
  assert.equal(items.length, 2);
  assert.equal(
    new URL(items[0].url).searchParams.get("path"),
    "/folder/photo.png",
  );
  assert.equal(new URL(items[0].url).searchParams.get("password"), "allowed");
  assert.ok(!JSON.stringify(items).includes("DO_NOT_COPY"));
  for (const bad of [
    request.replace("Share123", "Other123"),
    request.replace("app.koofr.net", "evil.test"),
    request.replace("/bundle", "/private"),
  ])
    assert.equal(S.koofrData(data, page, bad).length, 0);
  assert.equal(
    S.koofrData(
      { files: Array(1000).fill(data.files[0]), file: data.file },
      page,
      request,
    ).length,
    300,
  );
});
test("A root share keeps the known original name for type inference only", () => {
  const item = S.koofrData(
    {
      file: {
        name: "holiday.mov",
        type: "file",
        contentType: "video/quicktime",
      },
    },
    page,
    "https://app.koofr.net/api/v2/public/links/Share123",
  )[0];
  assert.equal(new URL(item.url).searchParams.get("path"), "/");
  assert.match(U.randomFilename(item), /^[a-f0-9]{32}\.mov$/);
  assert.equal(
    U.koofrFilePath(
      "/content/links/Share123/files/get?path=%2F&thumb=huge",
      page,
    ),
    "/",
  );
});
test("Koofr Referer contains share identity without passwords or other private parameters", () => {
  assert.equal(
    U.downloadReferrer(content, page),
    "https://app.koofr.net/links/Share123",
  );
  assert.equal(
    U.downloadReferrer("https://elsewhere.test/photo.png", page),
    "https://app.koofr.net/",
  );
  assert.equal(U.downloadReferrer("http://elsewhere.test/photo.png", page), "");
  const list = U.mediaList([{ ...U.koofrOriginal(content, page) }]);
  assert.ok(!list.includes("already-entered") && !list.includes("#private"));
});
