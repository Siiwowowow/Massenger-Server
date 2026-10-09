import { Global, Module } from '@nestjs/common';
import { EmailService } from './email.service';
import { VerificationEmailService } from './verification-email.service';

@Global()
@Module({
  providers: [EmailService, VerificationEmailService],
  exports: [EmailService, VerificationEmailService],
})
export class EmailModule {}
