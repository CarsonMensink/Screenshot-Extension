let lastClick = null;

document.addEventListener("contextmenu", (event) => {
    lastClick = { x: event.pageX, y: event.pageY };
});

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForScroll() {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await sleep(100);
}

function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
    });
}

async function requestCapture() {
    const response = await chrome.runtime.sendMessage({ type: "captureVisibleTab" });
    if (response?.error) throw new Error(response.error);
    return response.dataUrl;
}

async function waitForPaint() {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await sleep(50);
}

async function freezeViewport() {
    const dataUrl = await requestCapture();
    const overlay = document.createElement("div");
    overlay.style.cssText = [
        "position: fixed",
        "inset: 0",
        "z-index: 2147483647",
        "pointer-events: none",
        "margin: 0",
        "padding: 0",
    ].join(";");

    const img = document.createElement("img");
    img.src = dataUrl;
    img.style.cssText = "width: 100%; height: 100%; display: block; object-fit: fill;";
    overlay.appendChild(img);
    document.documentElement.appendChild(overlay);

    const htmlOverflow = document.documentElement.style.overflow;
    const bodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";

    return {
        overlay,
        remove() {
            overlay.remove();
            document.documentElement.style.overflow = htmlOverflow;
            document.body.style.overflow = bodyOverflow;
        },
    };
}

async function captureSlice(overlay) {
    overlay.style.visibility = "hidden";
    await waitForPaint();
    try {
        return await requestCapture();
    } finally {
        overlay.style.visibility = "visible";
    }
}

function scrollToInstant(x, y) {
    try {
        window.scrollTo({ left: x, top: y, behavior: "instant" });
    } catch {
        window.scrollTo(x, y);
    }
}

function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

async function copyToClipboard(blob) {
    try {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        return;
    } catch {
        // Firefox often requires clipboard write from the extension background.
    }

    const dataUrl = await blobToDataUrl(blob);
    const response = await chrome.runtime.sendMessage({ type: "copyImage", dataUrl });
    if (response?.error) throw new Error(response.error);
}

async function deliverResult(blob, outputMode) {
    if (outputMode === "tab") {
        const url = URL.createObjectURL(blob);
        window.open(url, "_blank");
        return;
    }

    await copyToClipboard(blob);
}

async function captureRegion(corner1, corner2, outputMode = "clipboard") {
    const x1 = Math.min(corner1.x, corner2.x);
    const y1 = Math.min(corner1.y, corner2.y);
    const x2 = Math.max(corner1.x, corner2.x);
    const y2 = Math.max(corner1.y, corner2.y);
    const width = Math.max(1, x2 - x1);
    const height = Math.max(1, y2 - y1);
    const dpr = window.devicePixelRatio || 1;

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext("2d");

    const originalScroll = { x: window.scrollX, y: window.scrollY };
    const maxScrollX = Math.max(0, document.documentElement.scrollWidth - window.innerWidth);
    const maxScrollY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);

    const freeze = await freezeViewport();

    try {
        let scanY = y1;
        while (scanY < y2) {
            const scrollY = Math.min(Math.max(0, scanY), maxScrollY);
            let scanX = x1;

            while (scanX < x2) {
                const scrollX = Math.min(Math.max(0, scanX), maxScrollX);
                scrollToInstant(scrollX, scrollY);
                await waitForScroll();

                const viewRight = scrollX + window.innerWidth;
                const viewBottom = scrollY + window.innerHeight;

                const sliceLeft = Math.max(x1, scrollX);
                const sliceTop = Math.max(y1, scrollY);
                const sliceRight = Math.min(x2, viewRight);
                const sliceBottom = Math.min(y2, viewBottom);
                const sliceW = sliceRight - sliceLeft;
                const sliceH = sliceBottom - sliceTop;

                if (sliceW > 0 && sliceH > 0) {
                    const dataUrl = await captureSlice(freeze.overlay);
                    const img = await loadImage(dataUrl);

                    ctx.drawImage(
                        img,
                        Math.round((sliceLeft - scrollX) * dpr),
                        Math.round((sliceTop - scrollY) * dpr),
                        Math.round(sliceW * dpr),
                        Math.round(sliceH * dpr),
                        Math.round((sliceLeft - x1) * dpr),
                        Math.round((sliceTop - y1) * dpr),
                        Math.round(sliceW * dpr),
                        Math.round(sliceH * dpr)
                    );
                }

                if (scrollX >= maxScrollX || scanX + window.innerWidth >= x2) break;
                scanX = scrollX + window.innerWidth;
            }

            if (scrollY >= maxScrollY || scanY + window.innerHeight >= y2) break;
            scanY = scrollY + window.innerHeight;
        }
    } finally {
        scrollToInstant(originalScroll.x, originalScroll.y);
        freeze.remove();
    }

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("Failed to create image");

    await deliverResult(blob, outputMode);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "getLastClick") {
        sendResponse(lastClick);
        return true;
    }

    if (message.type === "captureRegion") {
        captureRegion(message.corner1, message.corner2, message.outputMode)
            .then(() => sendResponse({ ok: true }))
            .catch((error) => sendResponse({ ok: false, error: error.message }));
        return true;
    }
});
