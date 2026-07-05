"use strict";

// This will alternate between 1 and 2 for the context menu
let cornerBeingPicked = 1;

// Holds all coordinate data
const corners = {
    1: { x: null, y: null },
    2: { x: null, y: null },
};

function resetCorners() {
    corners[1] = { x: null, y: null };
    corners[2] = { x: null, y: null };
    cornerBeingPicked = 1;
}

chrome.runtime.onInstalled.addListener(async () => {
    chrome.contextMenus.create({
        id: "screenshot",
        title: `Select corner ${cornerBeingPicked}`,
        contexts: ["all"],
    });

    // Already-open tabs don't get content_scripts until reload — inject manually once
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
        if (!tab.id || !tab.url?.startsWith("http")) continue;
        chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "captureVisibleTab") {
        const capture = sender.tab?.windowId !== undefined
            ? chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: "png" })
            : chrome.tabs.captureVisibleTab({ format: "png" });

        capture
            .then((dataUrl) => sendResponse({ dataUrl }))
            .catch((error) => sendResponse({ error: error.message }));

        return true;
    }

    if (message.type === "copyImage") {
        fetch(message.dataUrl)
            .then((response) => response.blob())
            .then((blob) => navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]))
            .then(() => sendResponse({ ok: true }))
            .catch((error) => sendResponse({ error: error.message }));

        return true;
    }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    // 1. Get the right-click location from the content script
    if (!tab?.id) return;

    let response;
    try {
        response = await chrome.tabs.sendMessage(tab.id, { type: "getLastClick" });
    } catch {
        console.error("Content script not available. Reload the extension, then refresh the page.");
        return;
    }

    if (!response) {
        console.error("Right-click the page first, then choose the menu item.");
        return;
    }

    const pickedCorner = cornerBeingPicked;
    corners[pickedCorner].x = response.x;
    corners[pickedCorner].y = response.y;

    if (pickedCorner === 2) {
        chrome.contextMenus.update("screenshot", { title: "Capturing..." });

        try {
            const { outputMode = "clipboard" } = await chrome.storage.local.get("outputMode");

            const result = await chrome.tabs.sendMessage(tab.id, {
                type: "captureRegion",
                corner1: { ...corners[1] },
                corner2: { ...corners[2] },
                outputMode,
            });

            if (result?.ok) {
                console.log(outputMode === "tab"
                    ? "Screenshot opened in new tab."
                    : "Screenshot copied to clipboard.");
            } else {
                console.error("Capture failed:", result?.error ?? "Unknown error");
            }
        } catch (error) {
            console.error("Capture failed:", error);
        }

        resetCorners();
    } else {
        cornerBeingPicked = 2;
    }

    chrome.contextMenus.update("screenshot", {
        title: `Select corner ${cornerBeingPicked}`,
    });
});
