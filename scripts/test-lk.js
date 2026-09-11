const { Room } = require('livekit-client');

const serverUrl = 'wss://massenger-pdvjmb8v.livekit.cloud';
// Generate token directly to test LiveKit Cloud connectivity
const { AccessToken } = require('livekit-server-sdk');
const at = new AccessToken('APIbvzAqXxS7Zbe', 'MQoB9lbtFfevMALKugnlEUhmC5ZIFkf1AYqXAXVZdYjB', {
  identity: 'test_node_user',
  name: 'Test Node',
});
at.addGrant({
  roomJoin: true,
  room: 'test_room_123',
  canPublish: true,
  canSubscribe: true,
});

async function main() {
  const token = await at.toJwt();
  console.log('Testing connection to LiveKit Cloud at:', serverUrl);
  // Note: in Node.js environment WebSocket might need ws polyfill or livekit-client handles it
  console.log('Token generated successfully.');
}
main().catch(console.error);
