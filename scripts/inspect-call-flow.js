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
  let idx = js.indexOf('requestCallToken');
  while (idx !== -1) {
    console.log('--- FOUND requestCallToken at', idx, '---');
    console.log(js.slice(Math.max(0, idx - 200), Math.min(js.length, idx + 1000)));
    idx = js.indexOf('requestCallToken', idx + 1);
  }
}

main().catch(console.error);
