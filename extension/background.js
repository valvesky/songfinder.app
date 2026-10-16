// Relays recorded audio from content scripts to the local identify server.
// Done here because pages can't fetch http://127.0.0.1 (mixed content / PNA).

const DEFAULT_SERVER = "http://127.0.0.1:8765";

async function serverUrl() {
  const { server } = await chrome.storage.sync.get("server");
  return server || DEFAULT_SERVER;
}

async function identify(base64, mime) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  let response;
  try {
    response = await fetch(`${await serverUrl()}/identify`, {
      method: "POST",
      headers: { "Content-Type": mime || "application/octet-stream" },
      body: bytes,
    });
  } catch {
    return { ok: false, error: "Cannot reach the local server. Start it with: server/identify_server.py" };
  }
  try {
    return await response.json();
  } catch {
    return { ok: false, error: `Server error ${response.status}` };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "identify-audio") {
    identify(msg.base64, msg.mime).then(sendResponse);
    return true;
  }
});
