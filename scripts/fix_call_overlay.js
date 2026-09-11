const fs = require('fs');
const path = require('path');
const frontendDir = path.resolve('../NESTJS-MASSENGER-FONTEND');

const file = path.join(frontendDir, 'src/features/communication/call/components/call-overlay.tsx');
let c = fs.readFileSync(file, 'utf8');

if (!c.includes('RoomAudioRenderer')) {
  c = c.replace('RoomContext,', 'RoomContext,\n  RoomAudioRenderer,');
}

if (!c.includes('<RoomAudioRenderer />')) {
  c = c.replace(
    '<RoomContext.Provider value={room}>',
    '<RoomContext.Provider value={room}>\n              <RoomAudioRenderer />'
  );
}

const rgx = new RegExp('>\\\\s*Unmute\\\\s*</button>', 'g');
c = c.replace(rgx, '>Enable Audio</button>');

c = c.replace(
  'Audio is paused by browser policy. <strong>Click anywhere here to enable sound.</strong>',
  'Audio is paused by browser policy. <strong>Click anywhere here to enable sound.</strong>'
);

fs.writeFileSync(file, c);
console.log('Fixed call-overlay.tsx');
