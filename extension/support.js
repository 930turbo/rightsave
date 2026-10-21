(async () => {
  const $ = (id) => document.getElementById(id),
    settings = await browser.storage.local.get({
      theme: "dark",
      quickSave: true,
      enhancedDetection: true,
      thumbnailSize: "large",
    });
  document.documentElement.dataset.theme = settings.theme;
  const guides = {
    first: {
      title: "Your first save",
      steps: [
        [
          "Open the page",
          "Use a regular webpage with an image you can see. Refresh the page if it was open before you installed RightSave.",
        ],
        [
          "Right-click the image",
          "Save As opens directly when Right-click Save As is enabled. Otherwise, choose RightSave → Save detected image from the menu.",
        ],
        [
          "Choose where it goes",
          "Pick a folder and filename, then choose Save. Canceling closes the dialog without starting another save.",
        ],
        [
          "Check Downloads",
          "Wait for the browser to finish. Firefox may show a temporary .part file while the transfer is in progress.",
        ],
      ],
    },
    collections: {
      title: "Save a collection",
      steps: [
        [
          "Open the media library",
          "Click RightSave in the browser toolbar, then Open media library. Alt + Shift + S also opens it from a webpage.",
        ],
        [
          "Choose your files",
          "Load all previews, open Filters & collection tools and select files. Search or filter first to narrow the selection. Invert and Clear help change it.",
        ],
        [
          "Choose how to save",
          "Save selected as ZIP uses one Save As dialog. Save selected opens a separate dialog for each file. Cancel a dialog, or use Stop after this file, to stop that queue.",
        ],
        [
          "Keep the ZIP manageable",
          "Use up to 100 files, 40 MB per file and 150 MB total. Skip identical files compares the actual bytes. Include source records adds private source links to CSV and JSON files.",
        ],
      ],
    },
    video: {
      title: "Find a video",
      steps: [
        [
          "Open and play the post",
          "Visit the post itself. Sign into the original site if needed and play the video so its source can load.",
        ],
        [
          "Scan again",
          "Open the media library, choose Videos and Rescan page. Click a loaded preview and Play video preview to watch, or Save video to choose a filename and folder. A player URL alone may not expose the file.",
        ],
        [
          "Try optional video detection",
          "In Settings, enable Detect direct video requests if you want to grant that permission. Play the video again, then rescan. It observes response URLs locally.",
        ],
        [
          "Read the label",
          "Video only means audio is separate. Streaming playlists and protected playback cannot be saved as a complete video here. Use the website’s own download option when available.",
        ],
      ],
    },
    convert: {
      title: "Save a converted copy",
      steps: [
        [
          "Open a larger preview",
          "Load the image preview in the library, then click it. Arrow keys move between previews.",
        ],
        [
          "Choose a format",
          "Expand Convert a still image. Choose PNG, JPEG or WebP. JPEG fills transparent areas with white.",
        ],
        [
          "Pick a size",
          "Choose a longest-side limit or Original size. Small images are never enlarged. Conversion supports sources up to 16 megapixels and 40 MB.",
        ],
        [
          "Save the copy",
          "Choose Save converted copy and pick its location. Conversion removes metadata and turns animation into a still frame. Save original keeps the source file instead.",
        ],
      ],
    },
    workflows: {
      title: "Save your setup",
      steps: [
        [
          "Set up the library",
          "Choose your filters, sort order and preview size. Add a filename template under Batch naming if you want one.",
        ],
        [
          "Name the workflow",
          "Open Saved workflows, enter a name and choose Save current workflow. The setup stays on this browser.",
        ],
        [
          "Use it again",
          "Choose its name and Apply. Review the selected files before saving; a workflow stores settings, not a browsing history or media collection.",
        ],
        [
          "Move it to another browser",
          "Export a workflow pack, then import that local JSON file on the other browser. Matching names are replaced. Keep up to 20 workflows.",
        ],
      ],
    },
  };
  const dialog = document.createElement("dialog");
  dialog.className = "guide-dialog";
  dialog.setAttribute("aria-labelledby", "guide-title");
  const top = document.createElement("div");
  top.className = "viewer-top";
  const title = document.createElement("h2");
  title.id = "guide-title";
  const close = document.createElement("button");
  close.className = "secondary";
  close.textContent = "Close guide";
  close.onclick = () => dialog.close();
  top.append(title, close);
  const progress = document.createElement("p");
  progress.className = "guide-progress muted";
  const heading = document.createElement("h3"),
    copy = document.createElement("p");
  copy.className = "guide-copy";
  const actions = document.createElement("div");
  actions.className = "viewer-bottom";
  const back = document.createElement("button"),
    next = document.createElement("button");
  back.className = "secondary";
  next.className = "primary";
  actions.append(back, next);
  dialog.append(top, progress, heading, copy, actions);
  document.body.append(dialog);
  let active,
    index = 0;
  function render() {
    const guide = guides[active];
    title.textContent = guide.title;
    progress.textContent = `Step ${index + 1} of ${guide.steps.length}`;
    heading.textContent = guide.steps[index][0];
    copy.textContent = guide.steps[index][1];
    back.textContent = "Previous";
    back.disabled = index === 0;
    next.textContent = index === guide.steps.length - 1 ? "Done" : "Next step";
  }
  back.onclick = () => {
    index--;
    render();
  };
  next.onclick = () => {
    if (index === guides[active].steps.length - 1) dialog.close();
    else {
      index++;
      render();
    }
  };
  document.querySelectorAll("[data-guide]").forEach(
    (button) =>
      (button.onclick = () => {
        active = button.dataset.guide;
        if (!guides[active]) return;
        index = 0;
        render();
        dialog.showModal();
      }),
  );
  if ($("help-search"))
    $("help-search").oninput = () => {
      const query = $("help-search").value.trim().toLowerCase();
      let found = 0;
      document.querySelectorAll("[data-help]").forEach((section) => {
        section.hidden = !section.textContent.toLowerCase().includes(query);
        if (!section.hidden) found++;
      });
      $("help-empty").hidden = found > 0;
    };
  function practiceSave(buttonId, statusId, file, filename, label) {
    if (!$(buttonId)) return;
    $(buttonId).onclick = async () => {
      $(buttonId).disabled = true;
      let url = "";
      try {
        const response = await fetch(browser.runtime.getURL(file));
        if (!response.ok) throw new Error("Missing practice file");
        url = URL.createObjectURL(await response.blob());
        const id = await browser.downloads.download({
          url,
          filename,
          saveAs: true,
          conflictAction: "uniquify",
        });
        $(statusId).textContent =
          `Practice ${label} sent to Downloads. You can choose any folder.`;
        const owned = url;
        url = "";
        const release = (delta) => {
          if (
            delta.id === id &&
            ["complete", "interrupted"].includes(delta.state?.current)
          ) {
            URL.revokeObjectURL(owned);
            browser.downloads.onChanged.removeListener(release);
          }
        };
        browser.downloads.onChanged.addListener(release);
        const [saved] = await browser.downloads.search({ id });
        if (saved && saved.state !== "in_progress")
          release({ id, state: { current: saved.state } });
      } catch (error) {
        $(statusId).textContent = /cancel/i.test(error.message)
          ? "Practice save canceled. Try again whenever you like."
          : "The file dialog could not open. Reopen this page and try again.";
      } finally {
        if (url) URL.revokeObjectURL(url);
        $(buttonId).disabled = false;
      }
    };
  }
  practiceSave(
    "practice-save",
    "practice-status",
    "practice.svg",
    "rightsave-practice.svg",
    "image",
  );
  practiceSave(
    "practice-video-save",
    "practice-video-status",
    "practice.webm",
    "rightsave-practice-video.webm",
    "video",
  );
  if ($("diagnostics"))
    $("diagnostics").onclick = async () => {
      const current = await browser.storage.local.get({
          theme: "dark",
          quickSave: true,
          enhancedDetection: true,
          thumbnailSize: "large",
        }),
        info = browser.runtime.getBrowserInfo
          ? await browser.runtime.getBrowserInfo()
          : {
              name: "Chromium",
              version:
                navigator.userAgent.match(
                  /(?:Chrome|Chromium)\/([\d.]+)/,
                )?.[1] || "unknown",
            };
      const network = await browser.permissions.contains({
        permissions: ["webRequest"],
      });
      $("diagnostic-output").value = [
        `RightSave ${browser.runtime.getManifest().version}`,
        `Browser: ${info.name} ${info.version}`,
        `Appearance: ${current.theme}`,
        `Preview size: ${current.thumbnailSize}`,
        `Right-click Save As: ${current.quickSave ? "on" : "off"}`,
        `Social detection: ${current.enhancedDetection ? "on" : "off"}`,
        `Video-request permission: ${network ? "on" : "off"}`,
      ].join("\n");
      $("diagnostic-output").hidden = false;
      $("copy-diagnostics").hidden = false;
    };
  if ($("copy-diagnostics"))
    $("copy-diagnostics").onclick = () =>
      navigator.clipboard.writeText($("diagnostic-output").value).then(
        () => {
          $("status").textContent =
            "Troubleshooting summary copied. Review it before posting.";
        },
        () => {
          $("diagnostic-output").focus();
          $("diagnostic-output").select();
          $("status").textContent = "Select and copy the summary manually.";
        },
      );
})().catch(() => {
  const status = document.getElementById("status");
  if (status)
    status.textContent =
      "Help is available below. Reopen this page if a control does not respond.";
});
