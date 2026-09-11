const https = require('https');

const postData = JSON.stringify({
  conversationId: '6a9c17da8c90a718ad2441b3'
});

const options = {
  hostname: 'massenger-server-j1jx.onrender.com',
  port: 443,
  path: '/api/v1/calls/token',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData),
    'x-project-id': '6a9a46e2c13d4f5a5538dcd5',
    'x-user-id': '6a9c11f4a42c67e48d0c1cf4'
  }
};

const req = https.request(options, (res) => {
  console.log('Status:', res.statusCode);
  console.log('Headers:', res.headers);
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    console.log('Body:', body);
  });
});

req.on('error', (e) => {
  console.error('Request error:', e);
});

req.write(postData);
req.end();
