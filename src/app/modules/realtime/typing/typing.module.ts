import { Module } from '@nestjs/common';
import { TypingService } from './typing.service';
import { InMemoryTypingStore } from './in-memory-typing.store';
import { TYPING_STORE } from './typing.store.interface';
import { ConversationModule } from '../../conversation/conversation.module';

@Module({
  imports: [ConversationModule],
  providers: [
    InMemoryTypingStore,
    TypingService,
    {
      provide: TYPING_STORE,
      useClass: InMemoryTypingStore,
    },
  ],
  exports: [TypingService, TYPING_STORE],
})
export class TypingModule {}
