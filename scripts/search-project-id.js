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

  for (const chunk of uniqueChunks) {
    const js = await fetch(`https://massange-fontend.vercel.app/_next${chunk}`);
    if (js.includes('x-project-id') || js.includes('X-Project-Id') || js.includes('PROJECT_ID')) {
      console.log(`Chunk ${chunk} has x-project-id`);
      const idx = js.indexOf('x-project-id');
      if (idx !== -1) {
        console.log('Snippet around x-project-id:', js.slice(Math.max(0, idx - 100), idx + 200));
      }
    }
  }
}

main().catch(console.error);
