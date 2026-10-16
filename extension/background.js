// Sends fingerprints to Shazam. Done here (not in the page) because only the
// extension's host permission lets us call amp.shazam.com without CORS.
importScripts?.("lib/shazam.js");

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "lookup") return;
  FindSongShazam.lookup(msg.signature)
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, error: e.message || "Lookup failed" }));
  return true;
});
