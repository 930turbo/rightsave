// Only public merchant/product identifiers belong in a packaged extension.
export function billingConfig(input) {
  if (!input || input.provider !== 'lemonsqueezy' || typeof input.testMode !== 'boolean' || !Number.isSafeInteger(input.storeId) || input.storeId < 1) throw new Error('Supply provider, testMode and a positive storeId.');
  const output={provider:'lemonsqueezy',testMode:input.testMode,storeId:input.storeId,products:{}};
  if(input.displayPrice){if(typeof input.displayPrice!=='string'||input.displayPrice.length>40)throw new Error('Invalid display price.');output.displayPrice=input.displayPrice;}
  const plans=input.products?.plus?['plus']:['pro','studio'];
  for(const plan of plans) {
    const p=input.products?.[plan];
    if(!p || !Number.isSafeInteger(p.productId) || p.productId<1 || !Number.isSafeInteger(p.variantId) || p.variantId<1)throw new Error(`Supply positive productId/variantId for ${plan}.`);
    if(/YOUR-STORE|REPLACE-/i.test(p.checkoutURL))throw new Error('Replace example checkout placeholders with merchant Share links.');
    const u=new URL(p.checkoutURL);
    if(u.protocol!=='https:' || !/^[a-z0-9-]+\.lemonsqueezy\.com$/.test(u.hostname) || u.port || u.username || u.password || !/^\/checkout\/buy\/[^/]+$/.test(u.pathname))throw new Error('Use the original HTTPS Lemon Squeezy Share link, not a cart or custom checkout.');
    output.products[plan]={productId:p.productId,variantId:p.variantId,checkoutURL:u.href};
  }
  if(plans.length>1&&output.products.pro.variantId===output.products.studio.variantId)throw new Error('Legacy variants must be distinct.');
  return output;
}
