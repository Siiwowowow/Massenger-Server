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
  let idx = 0;
  let matches = [];
  while ((idx = js.indexOf('.attach(', idx + 1)) !== -1) {
    matches.push(idx);
    console.log('Match at', idx, ':', js.slice(idx - 50, idx + 150));
  }
  console.log('Total .attach( calls:', matches.length);
}

main().catch(console.error);
