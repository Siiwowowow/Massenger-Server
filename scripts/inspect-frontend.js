const https = require('https');

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function main() {
  const html = await fetch('https://massange-fontend.vercel.app/');
  const chunkMatches = html.match(/\/static\/chunks\/[a-zA-Z0-9_\.~-]+\.js/g) || [];
  const uniqueChunks = [...new Set(chunkMatches)];
  console.log('Found chunks:', uniqueChunks.length);

  for (const chunk of uniqueChunks) {
    const js = await fetch(`https://massange-fontend.vercel.app/_next${chunk}`);
    const hasLivekit = js.includes('livekit') || js.includes('LiveKit');
    const hasCallToken = js.includes('calls/token') || js.includes('/calls');
    const hasWebRTC = js.includes('RTCPeerConnection') || js.includes('getUserMedia');
    if (hasLivekit || hasCallToken || hasWebRTC) {
      console.log(`Chunk ${chunk}: livekit=${hasLivekit}, calls/token=${hasCallToken}, webrtc=${hasWebRTC}`);
      // Find snippets
      const idx = js.indexOf('calls/token');
      if (idx !== -1) {
        console.log('Snippet around calls/token:', js.slice(Math.max(0, idx - 100), idx + 200));
      }
      const lkIdx = js.indexOf('livekit');
      if (lkIdx !== -1) {
        console.log('Snippet around livekit:', js.slice(Math.max(0, lkIdx - 100), lkIdx + 200));
      }
      const rtcIdx = js.indexOf('RTCPeerConnection');
      if (rtcIdx !== -1) {
        console.log('Snippet around RTCPeerConnection:', js.slice(Math.max(0, rtcIdx - 100), rtcIdx + 200));
      }
    }
  }
}

main().catch(console.error);
