// Maintainer CLI. Keep the private PEM outside this repository and release ZIPs.
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
const [command,...args]=process.argv.slice(2);
const value=name=>args[args.indexOf(name)+1];
if(command==='init'){
  if(!args.includes('--private')||!args.includes('--public'))throw new Error('Usage: node scripts/license.mjs init --private OUTSIDE_REPO.pem --public public-key.json');
  const {privateKey,publicKey}=crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'});
  await fs.writeFile(value('--private'),privateKey.export({type:'pkcs8',format:'pem'}),{flag:'wx',mode:0o600});
  await fs.writeFile(value('--public'),JSON.stringify(publicKey.export({format:'jwk'}),null,2)+'\n',{flag:'wx'});
  console.log('Created a private signing key and public verification key. Copy only the public JWK into commerce-config.json.');
}else if(command==='issue'){
  if(!args.includes('--private')||!args.includes('--id'))throw new Error('Usage: node scripts/license.mjs issue --private KEY.pem --id CUSTOMER_REFERENCE --plan pro|supporter [--expires YYYY-MM-DD]');
  const plan=args.includes('--plan')?value('--plan'):'pro';
  if(!['pro','supporter'].includes(plan))throw new Error('Invalid plan.');
  const claims={product:'rightsave',id:value('--id'),plan,issued:Date.now()};
  if(args.includes('--expires')){claims.expires=Date.parse(value('--expires'));if(!Number.isFinite(claims.expires)||claims.expires<=Date.now())throw new Error('Expiry must be a valid future date.');}
  const payload=Buffer.from(JSON.stringify(claims)).toString('base64url');
  const key=await fs.readFile(value('--private'),'utf8');
  const signature=crypto.sign('sha256',Buffer.from(payload),{key,dsaEncoding:'ieee-p1363'}).toString('base64url');
  console.log(payload+'.'+signature);
}else throw new Error('Choose init or issue. See README.md.');
