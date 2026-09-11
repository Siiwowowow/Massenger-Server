const fs = require('fs');
const path = require('path');
const frontendDir = path.resolve('../NESTJS-MASSENGER-FONTEND');

const file = path.join(frontendDir, 'src/features/communication/call/services/livekit-call-manager.ts');
let c = fs.readFileSync(file, 'utf8');

// 1. Remove track.attach and DOM container logic in TrackSubscribed
const subStart = c.indexOf('if (track.kind === Track.Kind.Audio) {');
const subEnd = c.indexOf('}', c.indexOf('} catch (attachErr) {')) + 1;
if (subStart !== -1 && subEnd !== -1) {
  const toReplace = c.substring(subStart, subEnd);
  if (toReplace.includes('track.attach')) {
    c = c.replace(toReplace, 'if (track.kind === Track.Kind.Audio) {\n            // Handled automatically by <RoomAudioRenderer /> in React.\n          }');
  }
}

// 2. Remove track.detach in TrackUnsubscribed
const unsubStart = c.indexOf('if (track.kind === Track.Kind.Audio) {', subEnd);
const unsubEnd = c.indexOf('}', c.indexOf('} catch (detachErr) {')) + 1;
if (unsubStart !== -1 && unsubEnd !== -1) {
  const toReplace2 = c.substring(unsubStart, unsubEnd);
  if (toReplace2.includes('track.detach')) {
    c = c.replace(toReplace2, 'if (track.kind === Track.Kind.Audio) {\n            // Handled automatically by <RoomAudioRenderer /> in React.\n          }');
  }
}

// 3. Fix unlockAudio / startAudio
if (c.includes('public async unlockAudio(): Promise<boolean> {')) {
  c = c.replace(
    /public async unlockAudio\(\): Promise<boolean> \{[\s\S]*?public async startAudio\(\): Promise<boolean> \{/m,
    `public async unlockAudio(): Promise<boolean> {
    return this.startAudio();
  }

  /**
   * Start or resume audio playback manually
   */
  public async startAudio(): Promise<boolean> {`
  );
}

if (c.includes('public async startAudio(): Promise<boolean> {') && c.includes('return this.unlockAudio();')) {
  c = c.replace(
    /public async startAudio\(\): Promise<boolean> \{[\s\S]*?return this\.unlockAudio\(\);\s*\}/,
    `public async startAudio(): Promise<boolean> {
    if (!this.room) {
      console.warn('[LiveKitCallManager] Cannot start audio: Room does not exist yet.');
      return false;
    }
    try {
      await this.room.startAudio();
      this.setMediaState({ isAudioPlaybackBlocked: false });
      return true;
    } catch (err) {
      console.warn('[LiveKitCallManager] Failed to start audio:', err);
      this.setMediaState({ isAudioPlaybackBlocked: true });
      return false;
    }
  }`
  );
}

// 4. Clean up setMicrophoneEnabled extra args in AUDIO call
c = c.replace(
  /await room\.localParticipant\.setMicrophoneEnabled\(true, \{[\s\S]*?\}\);/,
  'await room.localParticipant.setMicrophoneEnabled(true);'
);

// 5. Add diagnostic logs to TrackSubscribed
if (!c.includes('DIAGNOSTICS')) {
  c = c.replace(
    /console\.log\(\s*\`\[LiveKitCallManager\] TrackSubscribed: kind=\$\{track\.kind\}, source=\$\{publication\.source\}, participant=\$\{participant\.identity\}\`\s*\);/g,
    `console.log(\`[LiveKitCallManager] TrackSubscribed: kind=\${track.kind}, source=\${publication.source}, participant=\${participant.identity}\`);
          console.log(\`[LiveKitCallManager DIAGNOSTICS] Remote audio publication count for \${participant.identity}: \${participant.audioTrackPublications.size}\`);`
  );

  c = c.replace(
    /this\.setMediaState\(\{\n\s*isMicEnabled: true,\n\s*isCameraEnabled: false,/,
    `console.log('[LiveKitCallManager DIAGNOSTICS] localParticipant.audioTrackPublications.size:', room.localParticipant.audioTrackPublications.size);
          this.setMediaState({
            isMicEnabled: true,
            isCameraEnabled: false,`
  );
}

// Remove remaining DOM cleanup from unlockAudio/disconnect if any
c = c.replace(/const container = document.getElementById\("livekit-audio-container"\);[\s\S]*?container\.remove\(\);\s*\}/g, '');

fs.writeFileSync(file, c);
console.log('Fixed livekit-call-manager.ts');
