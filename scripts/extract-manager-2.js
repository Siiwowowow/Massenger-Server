/* eslint-disable no-undef */
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
  const start = 953500;
  console.log(js.slice(start, start + 3000));
}

main().catch(console.error);
