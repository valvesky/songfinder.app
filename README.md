# findSong.app

Chromium extension (Brave, Chrome, Edge…) that finds the video you're watching on any
page (YouTube, X, anything with a `<video>`), outlines it so you know it's the right one,
and identifies the music in it via Shazam.

Based on `identify-song.py` (ffmpeg → 16 kHz WAV → `shazamio`).

## How it works

1. The content script lists every `<video>` (including iframes and shadow DOM).
2. The popup ranks them (playing first, then largest visible area). Hover a card to outline
   that exact video on the page; the best guess is outlined on open.
3. "Identify song" records ~12s of that video's audio (`captureStream`), the background
   worker posts it to a local server, which runs ffmpeg + Shazam. Result shows in the popup
   and on the video.

## Setup

```sh
# 1. companion server (needs uv + ffmpeg)
./server/identify_server.py            # http://127.0.0.1:8765

# 2. extension
# brave://extensions → Developer mode → Load unpacked → select ./extension
```

## Limitations

- The video must be playing; DRM or cross-origin media without CORS may expose no audio track.
- Audio fingerprints are sent to Shazam.
