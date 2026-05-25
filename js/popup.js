document.addEventListener("DOMContentLoaded", function () {
  const joinBtn = document.querySelector(".join-community");
  if (joinBtn) {
    joinBtn.addEventListener("click", () => {
      chrome.tabs.create({
        url: "https://www.facebook.com/groups/1226209499224609",
      });
    });
  }

  const shareButton = document.getElementById("share-button");
  if (shareButton) {
    window.LimitationService.isDownloadsLimited().then((isLimited) => {
      if (!isLimited) {
        shareButton.style.display = "none";
      }
      else{
        shareButton.addEventListener("click", () => {
          chrome.tabs.query(
            { active: true, currentWindow: true },
            (tabs) => {
              const activeTab = tabs[0];
              if (activeTab?.id) {
                chrome.tabs.sendMessage(activeTab.id, {
                  command: "show_sharing_popup",
                });
              }
            }
          );
          window.close();
        });

        const creditsInfoDiv = document.getElementById("download-credits-info");
        if (creditsInfoDiv) {
          Promise.all([
            window.LimitationService.getAvailableDownloadsCount(),
            window.LimitationService.getBaseDownloadLimit(),
            window.LimitationService.getDaysUntilLimitReset(),
            window.LimitationService.isSharedOnAllPlartforms(),
            window.LimitationService.isFakeLimitations()
          ]).then(async ([availableDownloads, baseLimit, daysLeft, isEverywhereShared, isFakeLimitation]) => {
            creditsInfoDiv.style.whiteSpace = "pre-line";
            let isHiddenCredisInfo = (availableDownloads == 0 && (isEverywhereShared && isFakeLimitation));
            if (!isHiddenCredisInfo){
              creditsInfoDiv.textContent =
                `Remaining download credits: ${availableDownloads} of ${baseLimit}.\nCredits reset in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`;
            }
          });
        }
      }
    })
  }
});
