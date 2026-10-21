import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const root = path.resolve(import.meta.dirname, "..");
const json = async (name) =>
  JSON.parse(await fs.readFile(path.join(root, name), "utf8"));
async function files(directory) {
  const found = [];
  for (const item of await fs.readdir(directory, { withFileTypes: true })) {
    const name = path.join(directory, item.name);
    if (item.isDirectory()) found.push(...(await files(name)));
    else found.push(name);
  }
  return found;
}
const source = await json("extension/manifest.json");
const expected = (await files(path.join(root, "extension")))
  .map((name) => path.relative(path.join(root, "extension"), name))
  .sort();
for (const target of ["firefox", "chrome"]) {
  const manifest = await json(`build/${target}/manifest.json`),
    directory = path.join(root, "build", target),
    built = await files(directory);
  assert.deepEqual(
    built.map((name) => path.relative(directory, name)).sort(),
    expected,
    "Build contains stale or unexpected files.",
  );
  assert.equal(manifest.version, source.version);
  assert.equal(manifest.manifest_version, 3);
  assert.ok(
    !manifest.externally_connectable && !manifest.web_accessible_resources,
  );
  assert.equal(
    manifest.content_security_policy.extension_pages,
    "script-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'",
  );
  assert.deepEqual(manifest.optional_permissions, ["webRequest"]);
  assert.ok(!manifest.permissions.includes("webRequest"));
  if (target === "chrome") {
    assert.equal(manifest.background.service_worker, "worker.js");
    assert.ok(!manifest.permissions.includes("cookies"));
  } else
    assert.deepEqual(
      manifest.browser_specific_settings.gecko.data_collection_permissions
        .required,
      ["none"],
    );
  for (const entry of manifest.content_scripts)
    for (const script of entry.js)
      await fs.access(path.join(directory, script));
  for (const name of built) {
    const relative = path.relative(directory, name);
    assert.ok(
      !/commerce|payments|billing|license|fixture|\.pem$|\.key$|\.md$|\.map$/i.test(
        relative,
      ),
      "Non-shipping material in browser package: " + relative,
    );
    if (/\.(js|html|json|css)$/.test(name)) {
      const text = await fs.readFile(name, "utf8");
      assert.ok(
        !/api\.lemonsqueezy|RightSaveCommerce|RightSavePayments|requirePro|requireStudio|-----BEGIN .*PRIVATE KEY/.test(
          text,
        ),
        "Commercial code or secret in package.",
      );
      if (name.endsWith(".js"))
        assert.ok(
          !/\beval\s*\(|new\s+Function\s*\(/.test(text),
          "Executable page text is forbidden.",
        );
      if (name.endsWith(".html"))
        for (const match of text.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g))
          assert.ok(
            /^[a-z0-9-]+\.js$/.test(match[1]),
            "Script must be bundled locally.",
          );
    }
  }
  console.log(
    `${target}: ${manifest.version}, all tools free, package boundaries checked`,
  );
}
const readme = await fs.readFile(path.join(root, "README.md"), "utf8");
assert.ok(!/\$\s*\d|pricing|\btiers?\b|\bStudio\b|\bPro\b/.test(readme));
for (const name of [
  "icon-128.png",
  "library-1280x800.png",
  "collections-1280x800.png",
  "help-1280x800.png",
  "video-1280x800.png",
  "promo-440x280.png",
  "marquee-1400x560.png",
])
  await fs.access(path.join(root, "store/assets", name));
for (const name of ["listing.txt", "review-notes.txt", "submission.html"])
  await fs.access(path.join(root, "store", name));
for (const name of ["privacy.html", "security.html"])
  await fs.access(path.join(root, "docs", name));
assert.deepEqual(
  await fs.readFile(path.join(root, "extension/practice.webm")),
  await fs.readFile(path.join(root, "docs/demo/rightsave-demo.webm")),
);
await fs.access(path.join(root, "docs/demo/rightsave-demo.mp4"));
console.log(
  "Listing, guides, privacy notice and submission assets are present. Mozilla signing and review remain external steps.",
);
