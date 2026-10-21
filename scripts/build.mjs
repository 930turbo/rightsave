import fs from "node:fs/promises";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
if (process.argv.length > 2)
  throw new Error(
    "This release has one fully free build. No billing configuration is accepted.",
  );
const common = JSON.parse(
  await fs.readFile(path.join(root, "extension/manifest.json"), "utf8"),
);
for (const target of ["firefox", "chrome"]) {
  const destination = path.join(root, "build", target);
  // Clean only this script's known build targets so deleted source files cannot ship.
  if (
    destination !== path.join(root, "build", "firefox") &&
    destination !== path.join(root, "build", "chrome")
  )
    throw new Error("Invalid build target.");
  await fs.rm(destination, { recursive: true, force: true });
  await fs.cp(path.join(root, "extension"), destination, { recursive: true });
  const manifest = structuredClone(common);
  if (target === "chrome") {
    delete manifest.browser_specific_settings;
    manifest.permissions = manifest.permissions.filter(
      (p) => !["menus", "cookies"].includes(p),
    );
    manifest.permissions.push("contextMenus");
    manifest.background = { service_worker: "worker.js" };
    manifest.minimum_chrome_version = "124";
  }
  await fs.writeFile(
    path.join(destination, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  console.log(`Built ${target} ${manifest.version}`);
}
