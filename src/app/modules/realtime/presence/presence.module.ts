import { Module } from '@nestjs/common';
import { PresenceService } from './presence.service';
import { InMemoryPresenceStore } from './in-memory-presence.store';
import { PRESENCE_STORE } from './presence.store.interface';

@Module({
  providers: [
    InMemoryPresenceStore,
    PresenceService,
    {
      provide: PRESENCE_STORE,
      useClass: InMemoryPresenceStore,
    },
  ],
  exports: [PresenceService, PRESENCE_STORE],
})
export class PresenceModule {}
