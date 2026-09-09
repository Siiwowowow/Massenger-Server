import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ConversationModule } from '../conversation/conversation.module';
import { CallService } from './call.service';
import { CallController } from './call.controller';
import { LiveKitService } from './livekit.service';
import { CallSignalingService } from './call-signaling.service';
import { InMemoryCallStore } from './store/in-memory-call.store';
import { CALL_STORE } from './store/call.store.interface';

@Module({
  imports: [ConfigModule, ConversationModule],
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
