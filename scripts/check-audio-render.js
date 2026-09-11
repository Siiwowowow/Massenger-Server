/* eslint-disable no-undef */
/* eslint-disable @typescript-eslint/no-require-imports */
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
  const js = await fetch('https://massange-fontend.vercel.app/_next/static/chunks/14r6m.nl3n-nc.js');
  const hasRoomAudioRenderer = js.includes('RoomAudioRenderer');
  const hasTrackSubscribed = js.includes('TrackSubscribed');
  const hasAttach = js.includes('.attach()');
  console.log('hasRoomAudioRenderer:', hasRoomAudioRenderer);
  console.log('hasTrackSubscribed:', hasTrackSubscribed);
  console.log('hasAttach:', hasAttach);

  if (hasTrackSubscribed) {
    let idx = js.indexOf('TrackSubscribed');
    while (idx !== -1) {
      console.log('Snippet TrackSubscribed:', js.slice(idx - 50, idx + 300));
      idx = js.indexOf('TrackSubscribed', idx + 1);
    }
  }
}

main().catch(console.error);
