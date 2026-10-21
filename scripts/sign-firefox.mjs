// Run only when the maintainer is ready to submit to Mozilla for signing.
// Supply credentials through the local environment, never command-line flags or Git.
import fs from 'node:fs/promises';
import path from 'node:path';
import webExt from 'web-ext';
const root = path.resolve(import.meta.dirname, '..');
const apiKey = process.env.WEB_EXT_API_KEY, apiSecret = process.env.WEB_EXT_API_SECRET;
if (!apiKey || !apiSecret) {
  console.error('Signing is not configured. Create a Mozilla Add-ons developer account and API credentials, then set WEB_EXT_API_KEY and WEB_EXT_API_SECRET locally. See store/submission.html.');
  process.exitCode = 1;
} else {
  const sourceDir = path.join(root, 'build', 'firefox');
  const manifest = JSON.parse(await fs.readFile(path.join(sourceDir, 'manifest.json'), 'utf8'));
  const sourceManifest = JSON.parse(await fs.readFile(path.join(root, 'extension', 'manifest.json'), 'utf8'));
  if (manifest.version !== sourceManifest.version) throw new Error('Build the current version with npm run build before signing.');
  const channel = process.env.RIGHTSAVE_AMO_CHANNEL || 'unlisted';
  if (!['listed', 'unlisted'].includes(channel)) throw new Error('RIGHTSAVE_AMO_CHANNEL must be listed or unlisted.');
  try {
    const result = await webExt.cmd.sign({sourceDir, artifactsDir: path.join(root, 'dist', 'signed'), apiKey, apiSecret,
      channel, amoBaseUrl: 'https://addons.mozilla.org/api/v5/', timeout: 300000,
      ...(process.env.RIGHTSAVE_AMO_METADATA ? {amoMetadata: process.env.RIGHTSAVE_AMO_METADATA} : {})});
    if (!result?.downloadedFiles?.length) throw new Error('A signed file has not been downloaded. Check the submission status in the Mozilla Developer Hub.');
    console.log('Mozilla signing succeeded. Signed files are in dist/signed/.');
  } catch (error) {
    console.error(String(error.message).replaceAll(apiKey, '[redacted]').replaceAll(apiSecret, '[redacted]'));
    process.exitCode = 1;
  }
}
