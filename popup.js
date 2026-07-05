const OUTPUT_MODE_KEY = "outputMode";
const DEFAULT_OUTPUT_MODE = "clipboard";

document.querySelectorAll('input[name="output"]').forEach((input) => {
    input.addEventListener("change", () => {
        if (input.checked) {
            chrome.storage.local.set({ [OUTPUT_MODE_KEY]: input.value });
        }
    });
});

chrome.storage.local.get(OUTPUT_MODE_KEY, (data) => {
    const mode = data[OUTPUT_MODE_KEY] ?? DEFAULT_OUTPUT_MODE;
    const selected = document.querySelector(`input[value="${mode}"]`);
    if (selected) selected.checked = true;
});
