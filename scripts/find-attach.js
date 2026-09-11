/* eslint-disable no-undef */
import { get } from 'https';

function fetch(url) {
  return new Promise((resolve, reject) => {
    get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function main() {
  const js = await fetch('https://massange-fontend.vercel.app/_next/static/chunks/14r6m.nl3n-nc.js');
  let idx = js.indexOf('attach');
  let count = 0;
  while (idx !== -1 && count < 20) {
    console.log('Found attach at', idx, ':', js.slice(Math.max(0, idx - 40), Math.min(js.length, idx + 100)));
    idx = js.indexOf('attach', idx + 1);
    count++;
  }
}

main().catch(console.error);
