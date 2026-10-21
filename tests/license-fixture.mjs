// Ephemeral test entitlement. No private key is written or packaged.
import crypto from 'node:crypto';
const {privateKey,publicKey}=crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'});
const payload=Buffer.from(JSON.stringify({product:'rightsave',id:'integration-test',plan:'pro'})).toString('base64url');
const signature=crypto.sign('sha256',Buffer.from(payload),{key:privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url');
console.log(JSON.stringify({publicKey:publicKey.export({format:'jwk'}),token:payload+'.'+signature}));
