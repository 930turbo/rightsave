<p align="center"><img src="docs/social-preview.png" alt="RightSave — Your media. Your folder." width="100%"></p>

# RightSave

Save images and direct-file videos from your browser. Right-click, choose a folder, and keep the file.

**Free local edition · Firefox + Chrome · Manifest V3 · No runtime dependencies**

![RightSave media library](docs/library.png)

## What you get

- Unlimited individual image and direct-video saves, always with Save As.
- Restored right-click menus, overlay detection and per-site controls.
- Large previews, Load all, search, sorting and click-to-expand images.
- Media-data adapters for Instagram, Facebook, X/Twitter, Reddit, Threads and LinkedIn.
- Responsive/lazy images, CSS backgrounds, accessible frames, open shadow roots, canvas and SVG export.
- Current-frame capture from unprotected videos and optional video-request detection.
- Dark glass styling with Light and System themes available.

## Install locally

Download the browser-specific ZIP from [Releases](https://github.com/930turbo/rightsave/releases).

### Firefox

Open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on…**, and select the Firefox ZIP. Remove an older temporary RightSave entry first and refresh your webpages afterward. Temporary loading lasts until Firefox restarts. Permanent installation requires Mozilla signing; [publishing instructions](store/submission.html) are included.

### Chrome

Extract the Chrome ZIP to a stable folder. Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the folder containing `manifest.json`. Refresh webpages and pin RightSave from the Extensions menu.

These packages are for local installation; neither is a browser-store listing.

## Use RightSave

Right-click media to open **Save As**. Turn off **Right-click Save As** in the popup, library or Settings to use the native submenu instead. Hold **Shift** while right-clicking for the normal browser menu, or **Alt** for website controls. **Alt + Shift + S** opens the library.

Open the post or carousel and play its video before rescanning. **Load all previews** loads previews, not downloads. Detection reads media data the page already loaded and makes no extra platform API calls. You can turn enhanced detection off or exclude individual sites in Settings.

## Free and Pro

The version published here is the free local edition. Core saving has no download quota or time limit. Pro is intended as a one-time local workflow license; pricing and checkout are not configured, and sales are not open.

| Capability | Free | Pro |
| --- | :---: | :---: |
| Unlimited individual Save As | ✓ | ✓ |
| Social-site detection and quality variants | ✓ | ✓ |
| Search, Load all, large previews and sorting | ✓ | ✓ |
| Canvas, SVG and video-frame export | ✓ | ✓ |
| Selected-file Save As queues | | ✓ |
| One ZIP for a selection | | ✓ |
| Saved filters, naming rules and preview settings | | ✓ |
| Filename/subfolder templates and dimension filters | | ✓ |
| JSON media-list export | | ✓ |

Pro functionality is implemented and requires a valid signed license; the free build has no automatic unlock. Optional supporter contributions are separate from Pro. There are no ads, affiliate redirects or hidden subscriptions. No payment buttons appear without a real destination.

ZIP export supports up to 100 files, 40 MB per file and 150 MB total. It runs in the library and may be restricted by authenticated media hosts. Firefox container sessions should use individual Save As. Saved workflows store their settings locally and can be deleted in the library.

## Compatibility and limits

Direct MP4/WebM files can be saved. Protected playback and segmented HLS/DASH streams are not merged. Reddit's separate video tracks are marked **Video only**. Signed links can expire, logins may be required, and site changes can affect detection. [Compatibility details](docs/compatibility.html).

Adapter tests use representative synthetic payloads and isolated browser fixtures. They are not a certification of every logged-in feed. Browser-restricted pages, closed shadow roots, cross-origin canvas protection and server restrictions still apply.

Firefox can briefly show a `.part` file alongside its placeholder while one download is in progress. Wait for the browser's Downloads panel to report completion. Concurrent requests for the same active file are coalesced.

## Privacy

RightSave has no analytics, advertising SDK or developer-operated backend. Media goes from its original host to your browser. Settings, optional licenses and saved workflows stay local; media lists and observations are temporary. Selected social response text is processed transiently and only bounded media fields are retained. [Full privacy notice](docs/privacy.html).

## Build and verify

Requires Node.js 22+ and npm:

```sh
npm ci
npm run build
npm test
npm run lint:firefox
python scripts/package.py
```

The default build creates the free edition in `build/firefox` and `build/chrome`. No remote runtime code or bundler is required. Browser tests use Python, Selenium and Pillow:

```sh
python -m pip install -r tests/requirements.txt
python tests/integration_firefox.py
python tests/integration_chromium.py
python tests/integration_social.py --browser firefox
python tests/integration_social.py --browser chrome
```

Set `FIREFOX_BINARY` or `CHROMIUM_BINARY` when necessary. Chromium or Chrome for Testing supports extension-loading flags. Tests use disposable profiles and locally generated media. Test-only file-picker/download overrides verify Save As requests without leaving unattended native dialogs. Licensed workflow tests use ephemeral test keys; private keys never enter release packages.

## Maintainer tools

`npm run sign:firefox` submits for Mozilla signing only when local API credentials are configured. [Store submission guide](store/submission.html).

`scripts/license.mjs` can generate an issuer key and sign a license. Keep the private PEM outside this repository. An explicitly licensed build uses `node scripts/build.mjs --public-key /path/to/public-jwk.json`. This is separate from the default free build. Local source can be modified by its user; client-side licensing is not tamper-proof DRM.

`scripts/screenshot.py`, `scripts/graphics.py` and `scripts/store-assets.py` capture the actual UI and prepare repository/store images. No private photos are required.

## Support and security

Use [Issues](https://github.com/930turbo/rightsave/issues) for reproducible bugs and feature requests. Include browser/version, platform and whether discovery, preview or saving failed. Do not post private media, signed URLs, cookies, credentials or license tokens. For security reports, use GitHub's private vulnerability reporting when available rather than publishing exploit details.

## License

Copyright © 2026 930turbo. The Free edition may be built and run locally at no charge. Pro requires a separate license; all other rights are reserved. This is not an open-source license. See [LICENSE](LICENSE).
