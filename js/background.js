import Analytics from "./analytics.js";
import { LimitationService } from './limitationService.module.js';
let nextFilename = null;
let lastFilenameSetTime = 0;

/**
 * Handles the tab updates by checking when the tab has finished loading,
 * started loading, or changed URL.
 *
 * @param {number} tabId - The ID of the tab being updated.
 * @param {object} changeInfo - Information about the changes made to the tab.
 * @param {object} tab - The current tab object.
 */
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Only proceed if the tab has a valid URL
  const isHttp =
    tab.url?.startsWith("http://") || tab.url?.startsWith("https://");

  if (!isHttp) return; // ❌ Skip if not http/https

  if (changeInfo.status === "complete") {
    console.log("✅ Tab finished loading:", tab.url);

    // Send a message to the content script if needed
    // chrome.tabs.sendMessage(tabId, {
    //   command: "TAB_LOADED",
    //   message: "Tab fully loaded from background",
    // });
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, {
          command: "TAB_LOADED",
          message: "Tab fully loaded from background",
        });
      }
    });
  }

  if (changeInfo.status === "loading") {
    console.log("🔄 Tab started loading:", tab.url);
  }

  if (changeInfo.url) {
    console.log("🌐 Tab URL changed to:", changeInfo.url);
  }
});

/**
 * Listens for messages sent from other parts of the extension like the popup
 * or content script and handles actions like downloading videos and clicking
 * download buttons.
 *
 * @param {object} request - The request object containing the action and additional data.
 * @param {object} sender - The sender of the message.
 * @param {function} sendResponse - The callback to send the response back.
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

  switch (request.action) {
    case "download":
      handleDownload(request);
      break;
    case "click_download":
      console.log("click_download! -- Event");
      Analytics.fireEvent("click_download");
      break;
    case "click_share_extension":
      Analytics.fireEvent("click_share_extension");
      break;
    default:
      break;
  }
});

// Utility: sanitize the filename
const sanitizeFilename = (name) => {
  return name?.replace(/[<>:"/\\|?*]+/g, "_");
};

// ✅ Utility: Wraps chrome.downloads.download in a Promise for async/await usage
const downloadFile = ({
  url,
  filename,
  saveAs = true,
  conflictAction = "uniquify",
}) => {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(
      {
        url,
        filename,
        saveAs,
        conflictAction,
      },
      (downloadId) => {
        // ❌ If there's an error (like invalid URL or permissions), reject the Promise
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          // ✅ Otherwise, resolve with the download ID
          resolve(downloadId);
        }
      }
    );
  });
};

// ✅ Handles the entire download process: video first, then caption
const handleDownload = async (request) => {
  console.log("download_video! -- Event");
  Analytics.fireEvent("download_video"); // 🔍 Analytics tracking
  try {
    // 🎥 Check if video download is required
    if (request?.video?.fileName) {
      // ✅ First, download video
      const videoId = await handleDownloadVideo(request);

      // 💤 Wait briefly to let Chrome clear internal download state
      await new Promise((res) => setTimeout(res, 500));

      // 📄 Now download caption if provided
      if (request?.caption?.videoId) {
        const captionId = await downloadCaption(request);
      }
    }
  } catch (err) {
    console.error("Download error:", err.message || err);
  }
};

// ✅ Downloads the video file
const handleDownloadVideo = async (request) => {
  try {
    if (request?.video?.fileName) {
      const wistiaUrl = request.video.url;
      // 🛠 Convert .bin URLs to .mp4 if needed
      const videoDownloadUrl = wistiaUrl.includes(".bin")
        ? wistiaUrl.replace(/\.bin$/, ".mp4")
        : wistiaUrl;

      // 🧼 Clean filename to remove illegal characters
      const sanitizedFilename = sanitizeFilename(request.video.fileName);

      // 📝 Prepare next filename for chrome.downloads.onDeterminingFilename

      const downloadPath = `Wistia Downloaded Videos/${sanitizedFilename}`; // 👈 Folder name here
      setNextFilename(downloadPath);
      // ⬇️ Start video download with override
      const videoDownloadId = await downloadFile({
        url: videoDownloadUrl,
        filename: downloadPath,
        saveAs: false, // ⚠️ Required to make filename override work
      });

      incrementDownloadCount?.(); // 📈 Optional: download tracking
      return videoDownloadId;
    }
  } catch (err) {
    console.error("Download error:", err.message || err);
  }
};

// ✅ Downloads the caption file
const downloadCaption = async (request) => {
  // Check if caption info exists
  if (request?.caption?.videoId) {
    const { videoId, lang = "en", videoName = "caption" } = request.caption;

    // 📄 Generate caption file URL and name
    const captionUrl = `https://fast.wistia.net/embed/captions/${videoId}.vtt?language=${lang}`;
    const captionFilename = sanitizeFilename(`${videoName}.vtt`);

    // 📝 Set next filename for filename handler
    const downloadPath = `Wistia Downloaded Videos/${captionFilename}`; // 👈 Folder name here
    setNextFilename(downloadPath);

    // ⬇️ Start caption download
    const captionDownloadId = await downloadFile({
      url: captionUrl,
      filename: downloadPath,
      saveAs: false, // ⚠️ Required for overriding filename
    });
  }

  return true; // ✅ Used to indicate success
};

// Track time to avoid race conditions
const setNextFilename = (name) => {
  nextFilename = name;
  lastFilenameSetTime = Date.now();
};

const filenameHandler = (downloadItem, suggest) => {
  const filename = nextFilename || downloadItem.filename;
  suggest({ filename });

  // Prevent reusing same filename for too long
  if (Date.now() - lastFilenameSetTime > 1000) {
    nextFilename = null;
  }
};

if (!chrome.downloads.onDeterminingFilename.hasListener(filenameHandler)) {
  chrome.downloads.onDeterminingFilename.addListener(filenameHandler);
}

/**
 * Listens for download changes and sends a message to the active tab when the
 * download is complete.
 *
 * @param {object} delta - The change information for the download state.
 */
chrome.downloads.onChanged.addListener((delta) => {
  try {
    if (delta.state && delta.state.current === "complete") {
      // Send message to the active tab
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        if (chrome.runtime.lastError) {
          console.error(
            "Error querying tabs:",
            chrome.runtime.lastError.message
          );
          return;
        }

        if (tabs.length === 0) {
          console.warn("No active tabs found.");
          return;
        }

        try {
          chrome.tabs.sendMessage(
            tabs[0].id,
            { command: "downloadComplete" },
            function (response) {
              if (chrome.runtime.lastError) {
              } else {
                console.log("Response from content script:", response);
              }
            }
          );
        } catch (error) {
          console.error(
            "Exception while sending message to content script:",
            error
          );
        }
      });
    }
  } catch (error) {
    console.error("Exception in download completion listener:", error);
  }
});

/**
 * Fired when the extension is installed. Sends an event to Analytics.
 *
 * @param {object} details - Details about the installation event.
 */
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    console.log("extension_installed! -- Event");
    Analytics.fireEvent("extension_installed");

    chrome.tabs.create({
      url: "install.html",
    });
  }

  readLimitationConfig();

  // Set uninstall URL ONCE (during install/update)
  chrome.runtime.setUninstallURL(
    "https://cyberpro.notion.site/1f1904b5fbe781e8be7aff25991e98cc?pvs=105"
  );
});

const incrementDownloadCount = () => {
  chrome.storage.local.get(
    ["downloadCount", "firstPopupShown", "firstFiveDownload"],
    ({
      downloadCount = 0,
      firstPopupShown = false,
      firstFiveDownload = false,
    }) => {
      const newCount = downloadCount + 1;

      chrome.storage.local.set({ downloadCount: newCount }, () => {
        // Handle special popup at count === 5
        if (newCount % 5 === 0 && !firstFiveDownload) {
          chrome.storage.local.set({ firstFiveDownload: true });
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const activeTab = tabs[0];
            if (activeTab?.id) {
              chrome.tabs.sendMessage(activeTab.id, {
                command: "rating_popup", // 🆕 You’ll handle this in content.js
              });
            }
          });
        }
        // feedback popup logic
        shouldShowFeedbackPopup(newCount, firstPopupShown).then(
          (shouldShow) => {
            if (shouldShow) {
              chrome.tabs.query(
                { active: true, currentWindow: true },
                (tabs) => {
                  const activeTab = tabs[0];
                  if (activeTab?.id) {
                    chrome.tabs.sendMessage(activeTab.id, {
                      command: "show_feedback_popup",
                    });
                  }
                }
              );
            }
          }
        );
      });
    }
  );
};

const shouldShowFeedbackPopup = async (count, firstPopupShown) => {
  const now = Date.now();
  const { lastPopupTimestamp = 0 } = await chrome.storage.local.get([
    "lastPopupTimestamp",
  ]);
  if (!lastPopupTimestamp) {
    // First time: set initial values and skip 2-minute restriction
    await chrome.storage.local.set({
      downloadCount: 1,
      lastPopupTimestamp: now,
    });
    return false; // allow download immediately
  }
  const oneWeekInMs = 7 * 24 * 60 * 60 * 1000;

  // First popup after 8
  if (count === 8 && !firstPopupShown) {
    await chrome.storage.local.set({ firstPopupShown: true });
    await chrome.storage.local.set({ downloadCount: 0 });
    await chrome.storage.local.set({ lastPopupTimestamp: 0 });
    return true;
  }

  if (now - lastPopupTimestamp > oneWeekInMs) {
    await chrome.storage.local.set({
      downloadCount: 0,
      lastPopupTimestamp: now,
    });
    return true;
  }
  return false;
};

const readLimitationConfig = async () => {
  try {
    const url = chrome.runtime.getURL("limitsConfig.json");
    const response = await fetch(url);
    if (!response.ok) throw new Error("Failed to fetch limitsConfig.json");
    const config = await response.json();
    // Store or use the config as needed
    // await chrome.storage.local.set({ limitationConfig: config });
    console.log("Limitation config loaded:", config);
    LimitationService.setLimitationConfig(config);
    return config;
  } catch (error) {
    console.error("Error loading limitation config:", error);
    return null;
  }
};