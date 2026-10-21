import fs from 'node:fs/promises';
import path from 'node:path';
import {billingConfig} from './billing-config.mjs';
const root = path.resolve(import.meta.dirname, '..');
const common = JSON.parse(await fs.readFile(path.join(root,'extension','manifest.json'),'utf8'));
const keyIndex=process.argv.indexOf('--public-key');
const billingIndex=process.argv.indexOf('--billing');
const lemon=billingIndex>=0?billingConfig(JSON.parse(await fs.readFile(process.argv[billingIndex+1],'utf8'))):null;
let publicKey=null;
if(keyIndex>=0){
  publicKey=JSON.parse(await fs.readFile(process.argv[keyIndex+1],'utf8'));
  if(publicKey.kty!=='EC'||publicKey.crv!=='P-256'||!publicKey.x||!publicKey.y||publicKey.d)throw new Error('Supply a public P-256 JWK without private key material.');
}
for (const target of ['firefox','chrome']) {
  const destination = path.join(root,'build',target);
  await fs.mkdir(destination,{recursive:true});
  await fs.cp(path.join(root,'extension'),destination,{recursive:true});
  const commerce=JSON.parse(await fs.readFile(path.join(root,'extension','commerce-config.json'),'utf8'));
  commerce.edition=publicKey||lemon?'licensed':'free';commerce.publicKey=publicKey;commerce.lemon=lemon;
  await fs.writeFile(path.join(destination,'commerce-config.json'),JSON.stringify(commerce,null,2)+'\n');
  const manifest = structuredClone(common);
  if(lemon)manifest.browser_specific_settings.gecko.data_collection_permissions={required:['authenticationInfo']};
  if (target==='chrome') {
    delete manifest.browser_specific_settings;
    manifest.permissions = manifest.permissions.filter(p=>!['menus','cookies'].includes(p));
    manifest.permissions.push('contextMenus');
    manifest.background = {service_worker:'worker.js'};
    manifest.minimum_chrome_version = '124';
  }
  await fs.writeFile(path.join(destination,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  console.log(`Built ${target} ${manifest.version}`);
}
