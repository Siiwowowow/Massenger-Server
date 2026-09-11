const fs = require('fs');
const path = require('path');
const file = path.resolve('../NESTJS-MASSENGER-FONTEND/src/features/communication/call/services/livekit-call-manager.ts');
let c = fs.readFileSync(file, 'utf8');

c = c.replace(
`          if (track.kind === Track.Kind.Audio) {
            // Handled automatically by <RoomAudioRenderer /> in React.
          } catch (attachErr) {
              console.error("[LiveKitCallManager] Failed to attach remote audio track:", attachErr);
            }
          }`,
`          if (track.kind === Track.Kind.Audio) {
            // Handled automatically by <RoomAudioRenderer /> in React.
          }`
);

c = c.replace(
`          if (track.kind === Track.Kind.Audio) {
            try {
              track.detach().forEach((el) => el.remove());
              const existing = document.getElementById(\`livekit-remote-audio-\${participant.identity}\`);
              if (existing) {
                existing.remove();
              }
            } catch (detachErr) {
              console.warn("[LiveKitCallManager] Track detach warning:", detachErr);
            }
          }`,
`          if (track.kind === Track.Kind.Audio) {
            // Handled automatically by <RoomAudioRenderer /> in React.
          }`
);

fs.writeFileSync(file, c);
console.log('Fixed syntax error in livekit-call-manager.ts');
