const style = document.createElement("style");
style.textContent = `
 span.lang-option.active {
    background: rgb(61, 29, 57) !important;
    color: #fff !important;
}
  #download-ul .checkbox input.checkbox {
    POSITION: relative;
    background-color: white !important;
    width: 14px;
    height: 14px;
    margin-top: 1px !important;
  }
  #download-ul .checkbox {
    margin: 0px !important;
    display: flex;   
  }`;
document.head.appendChild(style);
const WISTIA_DOWNLOADER_EXTENSION_URL = "https://chromewebstore.google.com/detail/wistia-video-downloader-p/fhmlmcbfjnegdoafmfcfmhpahfegdjlp";
const WISTIA_EMBED_URL = "https://fast.wistia.net/embed/iframe/";
// (Alona Z.) Class to identify additional Wistia embeds when they don't have the wistia_embed class
const WISTIA_EMBED_ADDITIONAL_CLASS = "wistia_embed_additional";
const callback = [];
let activeToast = null;

const myContentPage = {
  // Main function to load the iframe when the page loads
  load() {
    this.loadIframe();
    this.waitForIframeAppears();
    // (Alona Z.) Observe existing <figure> elements
    document.querySelectorAll('figure').forEach((figure) => this.observeInsideFigure(figure));
  },

  // (Alona Z.) Observe <figure> in case it initially has only an image and replaces it with an <iframe> later (e.g. on autoplay or user interaction)
  observeInsideFigure(figureElem) {
    const iframeWatcher = new MutationObserver((mutationsList, obs) => {
      for (const mutation of mutationsList) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== 1) continue;

          if (
            node.tagName === 'IFRAME' &&
            node.src.includes('wistia') &&
            node.src.includes('/embed/iframe/')
          ) {
            console.log('🎯 1 Wistia iframe appeared directly!', node);
            this.loadIframe(); // 'this' is correct here
            obs.disconnect();
          }

          const iframe = node.querySelector?.('iframe[src*="wistia"][src*="/embed/iframe/"]');
          if (iframe) {
            console.log('🎯 2 Wistia iframe appeared inside subtree!', iframe);
            this.loadIframe(); // 'this' is correct here
            obs.disconnect();
          }
        }
      }
    });

    iframeWatcher.observe(figureElem, { childList: true, subtree: true });
  },

  waitForIframeAppears() {
      const observer = new MutationObserver((mutationsList) => {
      for (const mutation of mutationsList) {
        for (const node of mutation.addedNodes) {
          // Check if the added node is an iframe with Wistia embed URL
          // (Alona Z.) There are able a few type of URLs:
          // fast.wistia.com/embed/iframe/ OR fast.wistia.net/embed/iframe/
          if (
            // node.nodeType === 1 &&
            node.tagName === 'IFRAME' &&
            (node.src.includes('fast.wistia') && node.src.includes('/embed/iframe/'))
          ) {
            console.log('MutationObserver detected a change:', node);
            if (!node.classList.contains("wistia_embed")) {
              // (Alona Z.) Add class for detecting Wistia embedded video modals
              node.classList.add(WISTIA_EMBED_ADDITIONAL_CLASS);
            }
            this.loadIframe();
          }
          else if (
            // node.nodeType === 1 &&
            node.tagName === 'FIGURE'
          ) {
            // Found the <figure> element — now observe inside it
            console.log('Found <figure> element');
            this.observeInsideFigure(node);
          }
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  },

  // Finds Wistia players on the page and fetches video data
  loadIframe() {
    document
      .querySelectorAll(
        "iframe[src*='fast.wistia'][src*='/embed/iframe/'], wistia-player, .wistia_embed, .w-json-ld, #__NEXT_DATA__, ." + WISTIA_EMBED_ADDITIONAL_CLASS
      )
      .forEach((player) => {
        let mediaId =
          player.getAttribute("media-id") ||
          player.className.match(/wistia_async_([\w]+)/)?.[1] ||
          player.className.match(/VideoPlayerWrapper([\w]+)/) ||
          player.getAttribute("data-wistiaid");

        if (!mediaId && player.tagName === "SCRIPT") {
          try {
            if (
              player?.textContent &&
              JSON.parse(player?.textContent).embedUrl
            ) {
              mediaId = JSON.parse(player.textContent).embedUrl;
            } else {
              let lpAttachmentsData = JSON.parse(player.textContent).props
                .pageProps;
              if (lpAttachmentsData?.course) {
                const urlObj = new URL(window.location.href);
                const videoId = urlObj.searchParams.get("md");
                let course = lpAttachmentsData?.course?.children;
                const flatCourses = course.flatMap((child) =>
                  child.children
                    ? child.children.map((c) => c.course)
                    : child?.course
                );

                let findObject = flatCourses.filter(
                  (item) => item?.id == videoId
                );
                mediaId = findObject.length
                  ? findObject[0].metadata.videoLink.split("/").pop()
                  : "";
              } else {
                lpAttachmentsData =
                  lpAttachmentsData?.currentGroup?.metadata
                    ?.lpAttachmentsData || "";
                if (lpAttachmentsData) {
                  // If you want to parse it to a JavaScript object:
                  const parsedAttachments = JSON.parse(lpAttachmentsData);
                  const videoUrls = parsedAttachments.attachments_data
                    .map((item) => item.video?.video_url.split("/").pop())
                    .filter((id) => id);
                  mediaId = videoUrls[0];
                }
              }
            }
          } catch (error) {
            return console.error("Error parsing JSON:", error);
          }
        }

        if (!mediaId) {
          // (Alona Z.) Get mediaId from the src attribute, used for Wistia embedded video modals
          mediaId = player.src?.match(/\/([\w-]+)(\?|$)/)?.[1]
        }

        // (Alona Z.) Check if a download button for this mediaId already exists
        let cleanMediaId = mediaId?.startsWith('http') ? mediaId.match(/\/([\w-]+)(\?|$)/)?.[1] : mediaId;
        if (document.querySelector(`[data-btn-wd-mediaid="${cleanMediaId}"]`)) {
          // Button already exists, skip fetch and button creation
          return;
        }
        console.log(mediaId, "it's MediaId");
        if (mediaId) {
          fetch(
            mediaId.startsWith("http") ? mediaId : WISTIA_EMBED_URL + mediaId
          )
            .then((response) => response.text())
            .then((html) => this.extractWistiaData(html, player, mediaId))
            .catch((error) =>
              console.error("Error fetching Wistia video:", error)
            );
        } else {
          console.log("No media ID found for Wistia player");
        }
      });
  },

  // Extracts video URLs and their display names from Wistia's response
  extractWistiaData(html, player, mediaId) {
    const urls = [...html.matchAll(/"url":\s*"([^"]+)"/g)].map(
      (match) => match[1]
    );
    const displayNames = [...html.matchAll(/"display_name":\s*"([^"]+)"/g)].map(
      (match) => match[1]
    );
    const size = [...html.matchAll(/"size":\s*(\d+)/g)].map(
      (match) => match[1]
    );
    const availableTranscriptsMatch = html.match(
      /"availableTranscripts":\s*(\[[^\]]*\])/
    );
    const lang = JSON.parse(availableTranscriptsMatch[1]);
    const languageCodes = lang.map((lang) => lang.language);
    let videoName;
    const match = html.match(/W\.iframeInit\((\{.*?\})\s*,\s*\{\}\);/s);
    if (match) {
      const jsonStr = match[1];
      const data = JSON.parse(jsonStr);
      videoName = data.name; // ✅ This is the video name you want
    }
    const results = urls
      .map((url, index) => ({
        display_name: displayNames[index] || "N/A",
        url,
        size: size[index] ? size[index] / (1024 * 1024) : "N/A",
      }))
      .filter(
        (item) =>
          ![
            "Storyboard",
            "Original File",
            "Thumbnail Image",
            "Thumbnail image",
            "N/A",
          ].includes(item.display_name)
      )
      .sort((a, b) => a.display_name.localeCompare(b.display_name));

    const customOrder = ["Auto", "224p", "360p", "540p", "720p", "1080p", "4k"];
    const sortedResults = results.sort(
      (a, b) =>
        customOrder.indexOf(a.display_name) -
        customOrder.indexOf(b.display_name)
    );

    this.addDownloadButton(
      player,
      sortedResults,
      languageCodes,
      mediaId,
      videoName
    );
  },

  // Adds a download button next to the video player
  addDownloadButton(player, results, languageCodes, mediaId, videoName) {
    if (!results?.length) {
      return false;
    }

    let cleanMediaId = mediaId?.startsWith('http') ? mediaId.match(/\/([\w-]+)(\?|$)/)?.[1] : mediaId;
    if (document.querySelector(`[data-btn-wd-mediaid="${cleanMediaId}"]`)) {
      // Button already exists, skip fetch and button creation
      return;
    }

    const imgurl = chrome.runtime.getURL("../image/wistia-logo.png");

    if (window.location.hostname == "wistia.com") {
      player.parentNode.style.position = "relative";
    }

    const newElement = document.createElement("img");
    newElement.src = imgurl;
    newElement.className = "download-img";
    newElement.id = "download";
    newElement.setAttribute("data-id", results.length ? results[0].url : "");

    newElement.style =
      "width: 35px; top: 20px; right: 20px; cursor: pointer; border-radius: 100px; background: #fff;";

    const isHTCUAboutPages =
      document.querySelector('[class*="VideoPlayerWrapper"]') != null;
    const isAdditionalWistiaEmbed = player.classList.contains(WISTIA_EMBED_ADDITIONAL_CLASS) && !player.classList.contains("wistia_embed");

    const wrapper = document.createElement("span"); // or 'div' if you prefer
    wrapper.className = "wista-download-video";
    wrapper.id = "downloader-div";

    wrapper.setAttribute("data-btn-wd-mediaid", cleanMediaId);
    wrapper.style =
      "width: 100%;text-align: right;display: flex;justify-content: end;align-items: center;position: absolute; top:20px;right:20px;";
    wrapper.style.position = isAdditionalWistiaEmbed ? "relative" : "absolute";

    const isVideoWrappedInFigure = (player.closest('figure') !== null);
    // (Alona Z.) Add intercom modals' styles
    if (isAdditionalWistiaEmbed && player.parentNode?.classList.contains("ds-new__modal__body")
        || isVideoWrappedInFigure
    ) {
      wrapper.style.marginBottom = "-35px";
      wrapper.style.top = "90px";
    }
    wrapper.style.zIndex = isHTCUAboutPages ? "9999" : "9999";
    wrapper.appendChild(newElement);

    const isHTCUAboutPage =
      document.querySelector('[class*="VideoPlayerWrapper"]') != null;
    isHTCUAboutPage
      ? (document.querySelector(
          '[class*="VideoPlayerWrapper"]'
        ).parentNode.style.position = "relative")
      : "";
    const insertTarget = isHTCUAboutPage
      ? document.querySelector('[class*="VideoPlayerWrapper"]')
      : player;
    // (Alona Z.) Check whether insertTarget has a parent node
    const isPlayerHasParent = (insertTarget.parentNode.tagName !== 'HEAD');

    if (insertTarget && wrapper) {
      if (isPlayerHasParent) {
        insertTarget.parentNode.insertBefore(wrapper, insertTarget);
      } else {
        // (Alona Z.) Prevent duplication of Wistia videos injected into main <head> by script
        let isInIframe = (window.top !== window);
        if (isInIframe) {
          document.body.insertBefore(wrapper, document.body.firstChild);
        }
      }
    }
    newElement.addEventListener("click", () => {
      // Send click event
      chrome.runtime.sendMessage({
        action: "click_download",
      });

      let dropdown = document.getElementById("download-ul");
      if (!dropdown) {
        dropdown = document.createElement("ul");
        dropdown.id = "download-ul";
        dropdown.style = `top: 45px; right: 3px; padding: 0; background: rgba(0, 0, 0, 0.7); border-radius: 10px; list-style: none; display: flex; flex-direction: column; gap: 1px; width: 140px;margin-top: 15px;`;
        dropdown.style.position = isAdditionalWistiaEmbed ? "relative" : "absolute";
        let isTopZIndexNeeded = (isAdditionalWistiaEmbed || !isPlayerHasParent || isVideoWrappedInFigure);
        dropdown.style.zIndex = isHTCUAboutPages ? "3" : (isTopZIndexNeeded ? "9999" : "1");
        // (Alona Z.) Add intercom modals' styles
        if (isAdditionalWistiaEmbed && player.parentNode?.classList.contains("ds-new__modal__body")
          || isVideoWrappedInFigure
        ) {
          dropdown.style.marginBottom = "-209px";
          dropdown.style.top = "115px";
          dropdown.style.marginLeft = isAdditionalWistiaEmbed ? "calc(100% - 140px)" : "unset";
        }

        const image_url = chrome.runtime.getURL("../image/loading.png");
        if (languageCodes.length > 0) {
          const checkboxDiv = document.createElement("div");
          checkboxDiv.className = "checkbox";
          checkboxDiv.style =
            "gap: 3px;padding: 9px 5px 7px; background: #f1f1f1;color: #000!important; border-top-left-radius: 8px;border-top-right-radius: 8px; ";

          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.className = "checkbox";
          checkbox.dataset.index = "0";
          checkboxDiv.appendChild(checkbox);
          dropdown.appendChild(checkboxDiv);

          let optionHtml =
            '<div class="lang-header" style="font-size: 12px;color: #000!important;line - height: 20px; " data-value="0">Download Caption</div>';
          languageCodes.forEach((lang) => {
            optionHtml += `
            <span class="lang-option" value="${lang}" data-name="${lang}" data-mediaId="${mediaId}" style="display: none; background: #ffffff; cursor:pointer;padding: 1px 6px !important;border-radius: 5px !important;font-size: 12px;color: #3d1d39;text-transform: capitalize;border: 1px solid #c5c5c5;">${lang}</span>`;
          });
          const langSelect = document.createElement("div");
          langSelect.id = "langSelect";
          langSelect.style = `
            font-size: 10px;
            padding-bottom: 3px;
            flex-direction: column;
            border-radius: 4px;
            color:white;
          `;
          langSelect.className = "checkbox";
          const wrpLang = document.createElement("div");
          wrpLang.style = `display:flex; flex-wrap:wrap; gap:3px;`;
          wrpLang.innerHTML = optionHtml;

          // ✅ Append the wrapped options to langSelect
          langSelect.appendChild(wrpLang);
          checkboxDiv.appendChild(langSelect);

          checkbox.addEventListener("change", () => {
            const header = langSelect.querySelector(".lang-header");
            const options = langSelect.querySelectorAll(".lang-option");
            if (checkbox.checked) {
              header.textContent = "choose language";
              header.style.cssText = `
                color: black;
                white-space: nowrap;
                text-transform: capitalize;
                font-size: 12px;
                margin-bottom: 2px
              `;
              options.forEach((opt) => (opt.style.display = "block"));
            } else {
              header.textContent = "Download Caption";
              options.forEach((opt) => (opt.style.display = "none"));
            }
          });

          langSelect.addEventListener("click", (e) => {
            document.querySelectorAll(".lang-option").forEach((option) => {
              option.classList.remove("active");
            });
            e.target.classList.add("active");
          });
        }
        results.forEach(({ display_name, url, size }) => {
          const listItem = document.createElement("li");
          listItem.textContent = `${display_name} [${size.toFixed(2)} MB]`;
          listItem.dataset.id = url;
          listItem.id = "download-list";
          listItem.className = "wista-list-download-video";
          listItem.dataset.name = display_name;
          listItem.dataset.videoName = videoName;
          listItem.style =
            "margin: 0px !important; margin-top: 0px !important;margin-bottom: 0 !important;list-style: none; padding: 5px 10px; color: #fff; font-size: 14px; text-align: center; cursor: pointer; display: flex; align-items: center; gap: 5px; justify-content: center;";
          listItem.addEventListener("click", handleDownloadItemClick);
          dropdown.appendChild(listItem);
        });
        const isHTCUAboutPage =
          document.querySelector('[class*="VideoPlayerWrapper"]') != null;
        const insertTarget = isHTCUAboutPage
          ? document.querySelector('[class*="VideoPlayerWrapper"]')
          : player;

        if (insertTarget && dropdown) {
          // const elements = insertTarget.querySelectorAll(`.wista-download-video`);
          // if (elements.length) {
          //   return true;
          // }
          // (Alona Z.) Check whether insertTarget has a parent node
          if (isPlayerHasParent) {
            insertTarget.parentNode.insertBefore(dropdown, insertTarget);
          } else {
            // (Alona Z.) Prevent duplication of Wistia videos injected into main <head> by script
            let isInIframe = (window.top !== window);
            if (isInIframe) {
              document.body.insertBefore(dropdown, document.body.firstChild);
            }
          }
        }
      } else {
        dropdown.remove();
      }
    });
  },
};

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.command === "downloadComplete") {
    console.log("Video Download Completed");
    window.LimitationService.decrementAvailableDownloadsCount();
  }

  if (request.command === "TAB_LOADED") {
    const link = document.createElement("link");
    Object.assign(link, {
      rel: "stylesheet",
      href: chrome.runtime.getURL("css/style.css"),
      type: "text/css",
    });
    document.head.appendChild(link);
    setTimeout(() => {
      myContentPage.load();
    }, 2000);
  }

  if (request.command === "show_feedback_popup") {
    console.log("Hit Show popup");
    if (!document.getElementById("custom-feedback-popup")) {
      const div = document.createElement("div");
      const imgUrl = chrome.runtime.getURL("image/icon.png");
      div.innerHTML = `
          <div class="popup-feedback" id="custom-feedback-popup" style="
            position: fixed;
            top: 5px;
            right: 5px;
            z-index: 99999;
            background-color: #fff;
            border: 1px solid #ccc;
            border-radius: 8px;
            padding: 10px;
            width: 90%;
            max-width: 370px;
            font-family: Arial, sans-serif;
            box-shadow: 0 0 15px rgba(0, 0, 0, 0.3);
            text-align: center;
          ">
            <h2 class="popup-feedback" style="font-size: 20px; margin: 0 0 10px; color: #222;"><img src="${imgUrl}" style="height: 25px;width: 25px;margin: 0 0 -5px 1px; position: relative;"/>We want to hear from you!</h2>
            <div class="popup-feedback" style="font-size: 14px; color: #444; margin: 10px 0;">
              What other video formats (beside Wistia) do you wish you could easily download?
            </div>
            <div class="popup-feedback" style="font-size: 14px; color: #444;">
            What other features do you need in this extension?
            </div>
            <a id="feedback-link"
              href="https://cyberpro.notion.site/1f2904b5fbe7813a9a05ff3ab52d5557?pvs=105"
              target="_blank"
              style="display:inline-block; margin-top:8px; background:#007bff; color:#fff; margin-bottom:5px;
                      padding:12px 18px; text-decoration:none; border-radius:8px; font-size:16px; transition: all 0.3s ease;">
              👉 Click here to answer
            </a><br>
            <a href="https://www.facebook.com/groups/1226209499224609" style=" text-decoration: underline; font-size: 14px; color: #0a58ca;">Join our community</a>
            </div>
  `;
      document.body.appendChild(div);

      // Close the popup when the feedback link is clicked
      document.getElementById("feedback-link").addEventListener("click", () => {
        document.getElementById("custom-feedback-popup")?.remove();
      });
    }
  }
  if (request.command === "rating_popup") {
    console.log("Hit rating popup");
    if (!document.getElementById("custom-rating-popup")) {
      const div = document.createElement("div");
      const imgUrl = chrome.runtime.getURL("image/icon.png");
      div.innerHTML = `
          <div class="popup-feedback" id="custom-rating-popup" style="
            position: fixed;
            top: 5px;
            right: 5px;
            z-index: 9999;
            background-color: #fff;
            border: 1px solid #ccc;
            border-radius: 8px;
            padding: 12px;
            width: 90%;
            max-width: 370px;
            font-family: Arial, sans-serif;
            box-shadow: 0 0 15px rgba(0, 0, 0, 0.3);
            text-align: center;
          ">
            <div class="popup-feedback" style="font-size: 14px; color: #444; margin: 0px 0px 8px;">
              Are you enjoying using the <strong>Wistia Downloader</strong> extension?
            </div>

            <a id="feedback-link"
              href="https://chromewebstore.google.com/detail/wistia-video-downloader/fhmlmcbfjnegdoafmfcfmhpahfegdjlp"
              target="_blank"
              style="display:inline-block; margin-top:px; background:#007bff; color:#fff; margin-bottom:8px;
                      padding:12px 18px; text-decoration:none; border-radius:8px; font-size:16px; transition: all 0.3s ease;">
              👉 Rate us now
            </a><br>
            <a href="https://www.facebook.com/groups/1226209499224609" style=" text-decoration: underline; font-size: 14px; color: #0a58ca; margin: 15px 0 0;">Join our community</a>
          </div>         
  `;
      document.body.appendChild(div);

      // Close the popup when the feedback link is clicked
      document.getElementById("feedback-link").addEventListener("click", () => {
        document.getElementById("custom-rating-popup")?.remove();
      });
    }
  }

  if (request.command === "show_sharing_popup") {
    let isRequestedByUser = true;
    showSharingExtensionPopup(isRequestedByUser);
  }
});

const downloadVideo = (parmObj) => {
  chrome.runtime.sendMessage({
    action: "download",
    ...parmObj,
  });
};

function handleDownloadItemClick(e) {
  let thisElement = this;

  Promise.all([
    window.LimitationService.isAvailableDownloads(),
    window.LimitationService.isSharedOnAllPlartforms(),
    window.LimitationService.isFakeLimitations()
  ]).then(async ([isAvailableDownload, isEverywhereShared, isUnlimited]) => {
    if (isAvailableDownload) {
      tryToVideoDownload(e, thisElement);
    }
    else {
      if (isEverywhereShared) {
        if (isUnlimited) {
          // (Alona Z.) If the user has unlimited downloads, just download the video
          tryToVideoDownload(e, thisElement);
        } else {
          // (Alona Z.) Show popup to share the extension
          showSharingExtensionPopup();
        }
      }
      else {
        showSharingExtensionPopup();
      }
    }
  })
}




// (Alona Z.) Show popup to share the extension
function showSharingExtensionPopup(isRequestedByUser=false) {
	
	
  if (!document.getElementById("custom-share-popup")) {
    const sharingPopup = document.createElement("div");
    const imgUrl = chrome.runtime.getURL("image/icon.png");
    Promise.all([
      window.LimitationService.getBaseDownloadLimit(),
      window.LimitationService.getSharingBonusDownloads(),
      window.LimitationService.getSharedThisWeekPlatforms()
    ]).then(async ([baseLimit, bonusDownloadsNumber, sharedPlatforms]) => {
      sharingPopup.innerHTML = `
          <div class="popup-share" id="custom-share-popup" style="
            position: fixed;
            top: 10px;
            right: 10px;
            z-index: 9999999999;
            background-color: #fff;
            border: 1px solid #ccc;
            border-radius: 8px;
            padding: 12px;
            width: 90%;
            max-width: 360px;
            font-family: Arial, sans-serif;
            box-shadow: 0 0 15px rgba(0, 0, 0, 0.3);
            text-align: center;
          ">
            <h2 class="popup-share" style="font-size: 18px; margin-bottom: 10px; color: #222;">
              <img src="${imgUrl}" style="height: 24px; width: 24px; margin-bottom: -5px;" />
              ${isRequestedByUser ? "Love the extension?" : "Unlock more FREE downloads!"}
            </h2>
            <div class="popup-share" style="font-size: 14px; color: #444; margin-bottom: 12px;">
              ${isRequestedByUser
                ? "Share it with friends and get " + bonusDownloadsNumber + " extra video downloads – for free! 💫"
                : "You've hit " + baseLimit + " free downloads this week, but you can <b>unlock " + bonusDownloadsNumber + " extra free downloads</b> by sharing this extension with friends! <br><br>Or you can wait a few days for your free downloads to reset (your credit resets every week)"
              }
            </div>
          </div>
        `;


      let isFacebookDisabled = sharedPlatforms && (sharedPlatforms['facebook'] === true);
      let isTwitterDisabled = sharedPlatforms && (sharedPlatforms['x'] === true);

      // 1. Create container div
      const buttonContainer = document.createElement('div');
      buttonContainer.style = "display: flex; gap: 10px; justify-content: center";

      // 2. Create Facebook button
      const facebookButton = document.createElement('button');
      facebookButton.id = 'share-facebook';
      facebookButton.textContent = 'Share on Facebook';
      facebookButton.style =
        "background: #1877f2; color: white; border: none; padding: 10px 14px; border-radius: 6px; font-size: 14px; cursor: pointer;";

      // 3. Create Twitter/X button
      const twitterButton = document.createElement('button');
      twitterButton.id = 'share-twitter';
      twitterButton.textContent = 'Share on X';
      twitterButton.style =
        "background: #1da1f2; color: white; border: none; padding: 10px 14px; border-radius: 6px; font-size: 14px; cursor: pointer;";

      // 4. Append buttons to container
      buttonContainer.appendChild(facebookButton);
      buttonContainer.appendChild(twitterButton);

      sharingPopup.querySelector('#custom-share-popup').appendChild(buttonContainer);
      document.body.appendChild(sharingPopup);

      // Share handlers
      attachShareHandler("share-facebook", "facebook", isFacebookDisabled);
      attachShareHandler("share-twitter", "x", isTwitterDisabled);
    });
  }
}

function attachShareHandler(buttonId, platform, isBtnDisabled=false) {
  const btn = document.getElementById(buttonId);
  if (!btn) return;
  const shareUrl = encodeURIComponent(WISTIA_DOWNLOADER_EXTENSION_URL);

  if (isBtnDisabled) {
    btn.disabled = true;
    btn.style.opacity = '0.6';
    btn.style.cursor = 'not-allowed';
  }
  else {
    btn.addEventListener("click", () => {
      let url = "";

      if (platform === "facebook") {
        // shareText is not able for Facebook share
        url = `https://www.facebook.com/sharer/sharer.php?u=${shareUrl}`;
      }
      else if (platform === "x") {
        const shareText = encodeURIComponent("This super helpful Chrome extension lets you download Wistia videos in 1 click – try it out!");
        url = ` https://twitter.com/intent/tweet?url=${shareUrl}&text=${shareText}`;
      }

      // NOTE: We use window.open instead of relying on native share modals,
      // because browser-provided sharing dialogs can be unstable and sometimes blocked.
      // Opening in a new tab/window is more reliable for ensuring the share page loads.

      openCenteredPopup(
        url,
        "Share the Wistia Downloader Extension",
        600,
        500
      );

      // Mark as shared
      btn.classList.add("disabled");
      btn.setAttribute("disabled", "true");

      chrome.runtime.sendMessage({
        action: "click_share_extension",
      });
      // Store in chrome.storage
      window.LimitationService.addBonusDownloads(platform);
      document.getElementById("custom-share-popup")?.remove();
    });
  }
}

function openCenteredPopup(url, title, w, h) {
  const dualScreenLeft = window.screenLeft ?? window.screenX;
  const dualScreenTop = window.screenTop ?? window.screenY;

  const width = window.innerWidth ?? document.documentElement.clientWidth ?? screen.width;
  const height = window.innerHeight ?? document.documentElement.clientHeight ?? screen.height;

  const left = dualScreenLeft + (width - w) / 2;
  const top = dualScreenTop + (height - h) / 2;

  return window.open(
    url,
    title,
    `scrollbars=yes, width=${w}, height=${h}, top=${top}, left=${left}`
  );
}


// Adds event listeners for specific elements on the page
// $(document).on("click", ".wista-list-download-video", function (e) 
// (Alona Z.) jQuery listeners don’t always work with elements inside a Shadow DOM
function tryToVideoDownload(e, thisElement) {
  e.preventDefault();
  const selectedLanguages = [];
  let videoMediaId;
  const isCaptionChecked = $('#download-ul input[type="checkbox"]').is(":checked");
  if (isCaptionChecked) {
    const $select = $("#langSelect .lang-option.active");
    if ($select.length) {
      const lang = $select.data("name");
      videoMediaId = $select.data("mediaid");
      if (lang && lang !== "0") {
        selectedLanguages.push(lang);
      }
    }
  }
  $(thisElement).addClass("active");
  $(thisElement).closest("ul").addClass("ul-active");
  $(thisElement).find("img").css("display", "block");
  $("#download-ul").remove();

  let fileName = thisElement.dataset.videoName.replace(/\s+/g, "") + ".mp4";

  let caption = {};
  if (selectedLanguages.length > 0) {
    let fileNameCaption = thisElement.dataset.videoName + `- ${selectedLanguages[0]}`;
    fileNameCaption = "Captions-" + fileNameCaption?.replace(/\s+/g, "");
    caption = {
      videoId: videoMediaId,
      lang: selectedLanguages[0],
      videoName: fileNameCaption,
    };
  }
  downloadVideo({
    video: {
      url: thisElement.dataset.id,
      fileName,
    },
    caption,
  });
}

const handleClickOutside = (event) => {
  if (
    event?.target?.className !== "download-img" &&
    event?.target?.className !== "checkbox" &&
    event?.target?.className !== "lang-option active"
  ) {
    $("#download-ul").remove();
  }
  if ("popup-feedback" != event?.target?.className) {
    $("#custom-feedback-popup")?.remove();
    $("#custom-rating-popup")?.remove();
    $("#custom-share-popup")?.remove();
  }
};

// Delay to avoid triggering from the same click that opened it
setTimeout(() => {
  document.addEventListener("click", handleClickOutside);
}, 0);

const getIcon = (type) => {
  switch (type) {
    case "success":
      return "check-circle-fill";
    case "error":
      return "x-circle-fill";
    case "warning":
      return "exclamation-triangle-fill";
    case "info":
      return "info-circle-fill";
    default:
      return "check-circle-fill";
  }
};

const capitalize = (str) => {
  return str.charAt(0).toUpperCase() + str.slice(1);
};

(() => {
  "use strict";

  // Prevent duplicate injections
  if (window.__notion_chrome_runtime_injected) {
    console.log("Script already injected, skipping.");
    return;
  }

  const scriptUrl = chrome.runtime?.getURL?.("js/blockClick.js");
  if (!scriptUrl) {
    console.error("chrome.runtime.getURL is unavailable.");
    return;
  }

  const injectScript = () => {
    if (document.head || document.documentElement) {
      if (window.__notion_chrome_runtime_injected) {
        clearInterval(injectionInterval);
        return;
      }

      const s = document.createElement("script");
      s.type = "module";
      s.src = scriptUrl;
      s.onload = function () {
        this.remove();
        console.log("Script injected and removed");
      };

      console.log("DBUG - injecting notion_chromeruntimeid");
      (document.head || document.documentElement).appendChild(s);

      // Mark as injected to avoid future injections
      window.__notion_chrome_runtime_injected = true;

      clearInterval(injectionInterval);
    }
  };

  const injectionInterval = setInterval(injectScript, 500);
})();
