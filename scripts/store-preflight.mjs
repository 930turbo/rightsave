import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'..'),json=async p=>JSON.parse(await fs.readFile(path.join(root,p),'utf8'));
const source=await json('extension/manifest.json');
for(const target of ['firefox','chrome']){
  const manifest=await json(`build/${target}/manifest.json`),config=await json(`build/${target}/commerce-config.json`);
  assert.equal(manifest.version,source.version);assert.equal(manifest.manifest_version,3);
  assert.equal(config.edition,'free');assert.equal(config.lemon,null);assert.equal(config.publicKey,null);
  assert.ok(manifest.optional_permissions.includes('webRequest'));
  assert.ok(!manifest.permissions.includes('webRequest'));
  if(target==='chrome'){assert.ok(manifest.background.service_worker);assert.ok(!manifest.permissions.includes('cookies'));}
  else assert.deepEqual(manifest.browser_specific_settings.gecko.data_collection_permissions.required,['none']);
  for(const entry of manifest.content_scripts)for(const script of entry.js)await fs.access(path.join(root,'build',target,script));
  console.log(`${target}: Free ${manifest.version}, local scripts, billing off`);
}
const readme=await fs.readFile(path.join(root,'README.md'),'utf8');
assert.ok(!/\$\s*\d|pricing|\btiers?\b|\bStudio\b|\bPro\b/.test(readme),'Public README must describe Free without pricing tiers.');
for(const name of ['icon-128.png','library-1280x800.png','saving-1280x800.png','promo-440x280.png','marquee-1400x560.png'])await fs.access(path.join(root,'store/assets',name));
for(const name of ['listing.txt','review-notes.txt','submission.html'])await fs.access(path.join(root,'store',name));
await fs.access(path.join(root,'docs/privacy.html'));
console.log('Free README, privacy page, listing copy and submission graphics are present. Store registration, signing and review are external steps.');
