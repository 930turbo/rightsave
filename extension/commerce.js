/* Offline ECDSA licenses. Private keys and payment credentials never ship. */
globalThis.RightSaveCommerce = (() => {
  let configPromise;
  const config = () => configPromise ||= fetch(browser.runtime.getURL("commerce-config.json")).then(r => r.json());
  const decode = value => Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), ch => ch.charCodeAt(0));
  async function verify(token) {
    const settings = await config();
    if (!settings.publicKey) throw new Error("License activation is not available in this release yet.");
    const [payload, signature, extra] = token.trim().split(".");
    if (!payload || !signature || extra || token.length > 8000) throw new Error("Invalid license format.");
    const key = await crypto.subtle.importKey("jwk", settings.publicKey, {name: "ECDSA", namedCurve: "P-256"}, false, ["verify"]);
    const valid = await crypto.subtle.verify({name: "ECDSA", hash: "SHA-256"}, key, decode(signature), new TextEncoder().encode(payload));
    if (!valid) throw new Error("This license signature could not be verified.");
    const claims = JSON.parse(new TextDecoder().decode(decode(payload)));
    if (claims.product !== "rightsave" || !["pro", "studio", "supporter"].includes(claims.plan) || !claims.id) throw new Error("This license is not for RightSave.");
    if (claims.expires && (!Number.isFinite(claims.expires) || claims.expires <= Date.now())) throw new Error("This license has expired.");
    return claims;
  }
  async function status() {
    if (typeof document !== "undefined" && !globalThis.RIGHTSAVE_BACKGROUND) return browser.runtime.sendMessage({type:"commerce",action:"status"});
    const settings = await config();
    const {license} = await browser.storage.local.get("license");
    let claims = null;
    if (license) try { claims = await verify(license); } catch { /* Do not trust stored plan flags. */ }
    const purchase = settings.lemon && await RightSavePayments.status(settings.lemon);
    if (purchase?.claims) claims=purchase.claims;
    const {purchaseLicense}=await browser.storage.local.get("purchaseLicense");
    return {pro: ["pro","studio"].includes(claims?.plan), studio:claims?.plan==="studio", plan: claims?.plan || "free", claims, config: settings, hasPurchase:!!purchaseLicense, offline:purchase?.offline||false, checked:purchase?.checked, error:purchase?.error};
  }
  async function activate(token) { const claims = await verify(token); await browser.storage.local.set({license: token.trim()}); return claims; }
  async function requirePro() { if (!(await status()).pro) throw new Error("This workflow is a Pro feature. Core image/video saving remains free."); }
  async function requireStudio() { if (!(await status()).studio) throw new Error("Shared workflow packs and source records require Studio."); }
  return {config, verify, status, activate, requirePro, requireStudio};
})();
