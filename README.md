<p><img src="docs/social-preview.png" alt="RightSave Free for Firefox and Chrome" width="100%"></p>

# RightSave Free

Find a photo or video you want to keep. Right-click it, choose a folder, and save it.

RightSave restores blocked right-click menus and looks through overlays for the media underneath. Open the gallery when you want a better look at everything on the page. Every tool is free, and you don’t need an account.

[Download for Firefox or Chrome](https://github.com/930turbo/rightsave/releases/latest) · [Install](#install) · [Report a problem](https://github.com/930turbo/rightsave/issues)

![RightSave’s gallery with large photographic previews](docs/library.png)

## See what you’re saving

Load the previews you need, or load the whole page’s gallery at once. Stop loading whenever you like. Search by name or link, then narrow things down by format, shape or minimum width. Known unsigned X image size variants can be grouped without changing the chosen original URL.

Click a loaded image for a larger view. Use the arrow keys to browse, or save the original from there. There’s also a Copy link button on each file. Press `/` to jump to search.

RightSave finds regular and lazy-loaded images, CSS backgrounds, accessible frames, canvas and SVG. It can capture the current frame of an unprotected video and save direct MP4, WebM and Ogg files.

## Save a video

Play the video on its webpage, open RightSave and choose **Videos**. Load a preview, click it, then choose **Play video preview** to watch before saving. **Save video** or **Save original** opens Save As so you can pick the filename and folder.

Direct MP4, WebM and Ogg files are supported. The original file keeps its sound when audio is included. A **Video only** label means the website provides a separate audio track; RightSave does not merge it. Protected playback and segmented streams cannot be combined.

[![RightSave playing a video with native playback controls and Save original](docs/video.png)](https://930turbo.github.io/rightsave/demo/video.html)

[Try the MP4 and WebM demo](https://930turbo.github.io/rightsave/demo/video.html). Both four-second samples have picture and sound. The app also includes an offline practice video and a saving walkthrough.

## Save a collection

Select the files you want, then save them in one ZIP. RightSave can skip identical files by comparing their bytes and add CSV and JSON source records if you need them. Every file gets a fresh random name, including the files inside a ZIP. Saved workflows remember your filters and preview size.

Open an image’s larger preview to resize it or save a PNG, JPEG or WebP copy. Everything runs on your device. ZIPs support up to 100 files, 40 MB per file and 150 MB total. Use individual saves for Firefox container sessions.

![RightSave’s how-to guides and practice save](store/assets/help-1280x800.png)

New to extensions? The quick start includes short walkthroughs and bundled practice media. There’s help for finding videos, making a ZIP and troubleshooting a failed save.

### On social sites

Instagram, Facebook, X, Reddit, Threads and LinkedIn each expose media differently. RightSave reads media details the page has already loaded. Open the post, scroll through its carousel or play its video, then rescan. Higher-quality direct files appear when the page provides them.

Sites change, and some videos aren’t delivered as a single file. Protected playback and segmented streams aren’t combined. Reddit’s separate video tracks are marked **Video only**. [Compatibility details](docs/compatibility.html).

## Koofr shared links

Open the shared link and enter its password on Koofr if needed. Open the photo or video, then right-click it or open RightSave and rescan. Refresh the Koofr page after updating the extension.

RightSave looks for the original shared file behind thumbnails and blob previews. It uses file details the page has already loaded and keeps the access parameters needed for the download. The share must still be accessible; expired links and segmented or protected video remain limited. Koofr coverage is checked against local shared-link fixtures, not every live share.

All saves use a new random 32-character name, followed by the file extension—for example, `d26b7d2cf9414afe868a06f4164a7cc8.mp4`. Save As still lets you choose the folder or change the name. Renaming does not remove metadata from the original file or clear your browser’s download history.

## Install

Get your browser’s ZIP from [Releases](https://github.com/930turbo/rightsave/releases/latest). The packages here are for local installation. Store submissions are being prepared; a store listing is only live once its link is published here.

| Firefox                                                                                                      | Chrome                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on…**, and select the Firefox ZIP. | Extract the Chrome ZIP into a folder you’ll keep. Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select that folder. |
| Temporary add-ons stay until Firefox restarts. Permanent installation requires Mozilla signing.              | Pin RightSave from the Extensions menu so it’s easy to reach.                                                                                              |

Remove an older temporary installation first. Refresh open webpages after installing or updating.

**Right-click Save As** opens the file dialog directly. Turn it off to use the browser’s RightSave submenu instead. Hold **Shift** while right-clicking for the normal browser menu, or **Alt** for website controls. **Alt + Shift + S** opens the gallery.

<details>
<summary>Why does Firefox show a .part file?</summary>

That’s the browser’s temporary download file. It becomes the finished file when the download completes. Wait for the Downloads panel to finish before opening it. Requests for the same active download are combined.

</details>

## Local by design

This repository and its downloads are the Free edition. They contain no checkout, activation or paywall code. They don’t load remote scripts or send your media to a developer server. Preferences stay on your device; page scans are temporary. Previews and downloads contact the original media hosts.

![The Free edition’s expanded image viewer](docs/viewer.png)

[Privacy notice](https://930turbo.github.io/rightsave/privacy.html) · [Release review](docs/security.html) · [Support](https://github.com/930turbo/rightsave/issues)

<details>
<summary>Build and verify</summary>

Requires Node.js 22+ and Python 3.

```sh
npm ci
npm run build
npm test
npm run lint:firefox
python scripts/package.py
```

The default build writes Free packages to `build/firefox` and `build/chrome`. There are no runtime dependencies. Browser checks use disposable profiles and local media:

```sh
python -m pip install -r tests/requirements.txt
python tests/integration_firefox.py
python tests/integration_chromium.py
python tests/integration_social.py --browser firefox
python tests/integration_social.py --browser chrome
python tests/integration_gallery.py --browser firefox
python tests/integration_gallery.py --browser chrome
python tests/integration_collections.py --browser firefox
python tests/integration_collections.py --browser chrome
python tests/integration_help.py --browser firefox
python tests/integration_help.py --browser chrome
python tests/integration_video.py --browser firefox
python tests/integration_video.py --browser chrome
python tests/integration_koofr.py --browser firefox
python tests/integration_koofr.py --browser chrome
```

Set `FIREFOX_BINARY` or `CHROMIUM_BINARY` if needed. Chrome for Testing supports extension-loading flags. Automated checks cover representative fixtures, not every live logged-in feed. [Latest verification](docs/verification.json).

[Store submission instructions](store/submission.html) and listing assets are included. Store accounts and any required registration remain the publisher’s responsibility.

</details>

Found a bug? Include your browser version, the site and what happened in an [issue](https://github.com/930turbo/rightsave/issues). Keep private media, cookies and signed links out of public reports.

Copyright © 2026 Gianni. Free local use is permitted under [LICENSE](LICENSE); other rights are reserved.
