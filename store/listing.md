# Store listing

**Name:** songfinder.app
**Short description (≤132 chars):** Name the song playing in any video. Outlines the right video, listens for 10 seconds, shows the track.

**Detailed description**

Hear a great track in a video and want to know what it is? songfinder.app identifies the
music in any video on any website: YouTube, X, Reddit, news sites, streams, embeds.

• A small button on every video: one click and it names the song (switch it off in the popup)
• Starts paused videos for you; play/pause from the popup too
• Finds every video on the page and outlines the one it will listen to, so you always know it's the right one
• Hover a video in the popup to see exactly which one it is on the page
• Listens for 10 seconds and shows the title and artist, with a link to the track
• Runs entirely in your browser: no account, no server of ours, no tracking

How it works: the extension records about 10 seconds of audio from the selected video, turns
it into a compact spectral fingerprint on your device, and sends only that fingerprint to a
music recognition service. The video, the page and your browsing history are never sent.

**Single purpose:** identify the music playing in a video on the current page.

**Permission justifications**
- `storage`: remember the overlay on/off setting.
- `activeTab`: act on the tab the user opened the popup in.
- `webNavigation`: list the frames of that tab so videos inside iframes are found.
- Host access `https://amp.shazam.com/*`: send the audio fingerprint for recognition.
- Content script on all sites: detect `<video>` elements and outline the chosen one.

**Assets:** `store/screenshot.png` (1280×800), `extension/icons/icon128.png`.
Trademark note: "Shazam" is a trademark of its owner; songfinder.app is not affiliated with it.
