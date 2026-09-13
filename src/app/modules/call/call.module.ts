import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ConversationModule } from '../conversation/conversation.module';
import { CallService } from './call.service';
import { CallController } from './call.controller';
import { LiveKitService } from './livekit.service';
import { CallSignalingService } from './call-signaling.service';
import { InMemoryCallStore } from './store/in-memory-call.store';
import { CALL_STORE } from './store/call.store.interface';
import { PresenceModule } from '../realtime/presence/presence.module';

@Module({
  imports: [ConfigModule, ConversationModule, PresenceModule],
  controllers: [CallController],
  providers: [
    CallService,
    LiveKitService,
    InMemoryCallStore,
    {
      provide: CALL_STORE,
      useClass: InMemoryCallStore,
    },
    CallSignalingService,
  ],
  exports: [
    CallService,
    LiveKitService,
    CallSignalingService,
    CALL_STORE,
    InMemoryCallStore,
  ],
})
export class CallModule {}
