import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
const shared=await fs.readFile(new URL('../extension/shared.js',import.meta.url),'utf8');
const commerce=await fs.readFile(new URL('../extension/commerce.js',import.meta.url),'utf8');
const context=vm.createContext({URL,Date,TextEncoder,TextDecoder,atob,crypto:crypto.webcrypto});
vm.runInContext(shared,context);const U=context.RightSaveUtil;
test('Only downloadable URL schemes are accepted',()=>{assert.equal(U.usableURL('javascript:alert(1)'),null);assert.equal(U.usableURL('', 'https://example.org'),null);assert.equal(U.usableURL('/photo.jpg','https://example.org'),'https://example.org/photo.jpg');});
test('Unplayable streaming resources are not passed off as complete videos',()=>{assert.ok(U.issue({kind:'video',url:'https://example.org/v.m3u8'}));assert.ok(U.issue({kind:'video',url:'blob:example'}));assert.equal(U.issue({kind:'video',url:'https://example.org/video.mp4'}),'');});
test('Filename sanitization handles encoded slashes and Windows devices',()=>{assert.equal(U.filename({kind:'image',url:'https://example.org/CON.png'}),'_CON.png');assert.equal(U.filename({kind:'image',url:'https://example.org/a%2Fb.jpg'}),'a_b.jpg');});
test('Batch templates never escape the download directory',()=>{const item={url:'https://example.org/a.png',pageURL:'https://example.org',kind:'image'};assert.equal(U.templatedFilename(item,'{site}/{name}-{index}.{ext}',2),'example.org/a-002.png');for(const template of ['../x.png','/x.png','C:/x.png','a/../x.png'])assert.throws(()=>U.templatedFilename(item,template));});
const {privateKey,publicKey}=crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'});
function token(claims){const payload=Buffer.from(JSON.stringify(claims)).toString('base64url');return payload+'.'+crypto.sign('sha256',Buffer.from(payload),{key:privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url');}
async function commerceContext(){const store={plan:'pro'};const ctx=vm.createContext({URL,Date,TextEncoder,TextDecoder,atob,crypto:crypto.webcrypto,fetch:async()=>({json:async()=>({publicKey:publicKey.export({format:'jwk'}),edition:'free'})}),browser:{runtime:{getURL:p=>p},storage:{local:{get:async()=>store,set:async v=>Object.assign(store,v)}}}});vm.runInContext(commerce,ctx);return ctx.RightSaveCommerce;}
test('A valid offline license unlocks Pro after signature verification',async()=>{const C=await commerceContext();await C.activate(token({product:'rightsave',id:'test-customer',plan:'pro'}));assert.equal((await C.status()).pro,true);});
test('Tampered, expired and wrong-product licenses are rejected',async()=>{const C=await commerceContext();const good=token({product:'rightsave',id:'x',plan:'pro'});await assert.rejects(()=>C.verify(good.replace('ey','ez')));await assert.rejects(()=>C.verify(token({product:'rightsave',id:'x',plan:'pro',expires:1})));await assert.rejects(()=>C.verify(token({product:'other',id:'x',plan:'pro'})));});
test('Production core is free while Pro workflow gates are enforced',async()=>{const C=await commerceContext();assert.equal((await C.status()).pro,false);await assert.rejects(()=>C.requirePro());});
test('Free installation ignores unsigned local plan flags',async()=>{const C=await commerceContext();const status=await C.status();assert.equal(status.pro,false);assert.equal(status.plan,'free');await assert.rejects(()=>C.requirePro());});
