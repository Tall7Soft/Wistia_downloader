// Limits configurtion file

// @param {boolean} isDownloadLimitEnabled - Set to true to activate limits feature.
// @param {number} baseDownloadLimit - The default number of downloads allowed within the reset period.
// @param {number} sharingBonus - Additional downloads granted as a bonus when the user shares the extension's link.
// @param {number} limitResetPeriodDays - Number of days after which the download limit resets.

export const LimitationService = {
    setLimitationConfig: (config) => {
        console.log("Setting limitation config:", config);
        chrome.storage.local.set({
            isDownloadLimitEnabled: config.isDownloadLimitEnabled,
            baseDownloadLimit: config.baseDownloadLimit,
            sharingBonus: config.sharingBonus,
            limitResetPeriodDays: config.limitResetPeriodDays,
            sharedThisWeek: {}, // example: { facebook: true, x: false }
            isAllowedDownloadsAfterBonus: config.isAllowedDownloadsAfterBonus || false,
        });

        LimitationService.startNewLimitPeriod();
    },
    getResetPeriod: () => {
        return new Promise((resolve) => {
            chrome.storage.local.get('limitResetPeriodDays', (result) => {
                resolve(result.limitResetPeriodDays || 7); // Default 1 week
            });
        });
    },
    setAvailableDownloadsCount: async (count) => {
        return (await chrome.storage.local.set({availableDownloadsCount: count}));
    },
    getBaseDownloadLimit: () => {
        return new Promise((resolve) => {
            chrome.storage.local.get('baseDownloadLimit', (result) => {
                resolve(result.baseDownloadLimit || 30); // Default to 30 if not set
            });
        });
    },
    getAvailableDownloadsCount: () => {
        return new Promise((resolve) => {
            chrome.storage.local.get('availableDownloadsCount', (result) => {
                resolve(result.availableDownloadsCount || 0);
            });
        });
    },
    getSharingBonusDownloads: () => {
        return new Promise((resolve) => {
            chrome.storage.local.get('sharingBonus', (result) => {
                resolve(result.sharingBonus || 0);
            });
        });
    },
    decrementAvailableDownloadsCount: async () => {
        let currentCount = await LimitationService.getAvailableDownloadsCount();
        let newCount = Math.max(0, currentCount - 1);
        await LimitationService.setAvailableDownloadsCount(newCount);
        return newCount;
    },
    addBonusDownloads: async (platform) => {
        const currentCount = await LimitationService.getAvailableDownloadsCount();
        let newCount = currentCount;
        LimitationService.getSharedThisWeekPlatforms().then(async (sharedPlatforms) => {
            if (LimitationService.isAbleShareOnPlatform(sharedPlatforms, platform)) {
                const bonusCount = await LimitationService.getSharingBonusDownloads();
                newCount = currentCount + bonusCount;
                LimitationService.setAvailableDownloadsCount(newCount);

                sharedPlatforms[platform] = true;
                chrome.storage.local.set({ sharedThisWeek: sharedPlatforms });
            }
            else{
                console.log(`${platform} already used on this period for bonus.`);
                return currentCount; // No change
            }
        });
        return newCount;
    },
    isDownloadsLimited: () => {
        return new Promise((resolve) => {
            chrome.storage.local.get('isDownloadLimitEnabled', (result) => {
                resolve(result.isDownloadLimitEnabled || false);
            });
        });
    },
    isAvailableDownloads: async () => {
        let result = true;
        let isLimitsEnabled = await LimitationService.isDownloadsLimited();
        if (isLimitsEnabled){
            await LimitationService.checkUpdateLimitsDate();
            const availableDownloadsNumber = await LimitationService.getAvailableDownloadsCount();
            result = availableDownloadsNumber > 0;
        }
        return result;
    },
    getDaysUntilLimitReset: async () => {
        return new Promise((resolve) => {
            chrome.storage.local.get('updateLimitsDate', (result) => {
                let daysLeft = 0;
                if (result.updateLimitsDate) {
                    const now = new Date();
                    const resetDate = new Date(result.updateLimitsDate);
                    daysLeft = Math.max(0, Math.ceil((resetDate - now) / (1000 * 60 * 60 * 24)));
                }
                resolve(daysLeft);
            });
        });
    },
    checkUpdateLimitsDate: async() => {
        return new Promise((resolve) => {
            chrome.storage.local.get(['updateLimitsDate', 'resetPeriod'], async(result) => {
                let currentDate = new Date();
                let limitationResetPerion = result.resetPeriod || 7; // Default to 7 days if not set
                let updateDate = result.updateLimitsDate;
                let updateDateObj = updateDate ? new Date(updateDate) : null;

                if (!updateDateObj || updateDateObj < currentDate) {
                    await LimitationService.startNewLimitPeriod();
                    updateDate = new Date(currentDate.setDate(currentDate.getDate() + limitationResetPerion));
                }

                resolve(updateDate);
            });
        });
    },
    startNewLimitPeriod: async () => {
        console.log("Starting new limit period");

        const baseDownloadLimit = await LimitationService.getBaseDownloadLimit();
        await LimitationService.setAvailableDownloadsCount(baseDownloadLimit);

        let numberDays = await LimitationService.getResetPeriod();
        if (!numberDays) numberDays = 7;

        const currentDate = new Date();
        const updateDate = new Date(currentDate.setDate(currentDate.getDate() + numberDays));
        console.log("New updateLimitsDate date:", updateDate);
        chrome.storage.local.set({
            updateLimitsDate: updateDate.toISOString(),
            sharedThisWeek: {}, // reset share flags
        });
    },
    isAbleShareOnPlatform: (sharedPlatforms, platform) => {
        let result = sharedPlatforms && (sharedPlatforms[platform] !== true);
        console.log(`isAbleShareOnPlatform(${platform}): `, result);
        return result;
    },
    getSharedThisWeekPlatforms: () => {
        return new Promise((resolve) => {
            chrome.storage.local.get('sharedThisWeek', (result) => {
                resolve(result.sharedThisWeek || {});
            });
        });
    },
    isSharedOnAllPlartforms: async () => {
        let result = false;
        let sharedPlatforms = await LimitationService.getSharedThisWeekPlatforms();
        if (sharedPlatforms) {
            result = !LimitationService.isAbleShareOnPlatform(sharedPlatforms, 'facebook') &&
                     !LimitationService.isAbleShareOnPlatform(sharedPlatforms, 'x');
        }
        return result;
    },
    isFakeLimitations: () => {
        return new Promise((resolve) => {
            chrome.storage.local.get('isAllowedDownloadsAfterBonus', (result) => {
                resolve(result.isAllowedDownloadsAfterBonus || false);
            });
        });
    },
};