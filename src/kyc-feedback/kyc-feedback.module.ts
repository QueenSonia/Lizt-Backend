import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KycFeedbackService } from './kyc-feedback.service';
import { KycFeedbackController } from './kyc-feedback.controller';
import { KycFeedback } from './entities/kyc-feedback.entity';
import { ScopeModule } from 'src/common/scope/scope.module';

@Module({
  imports: [TypeOrmModule.forFeature([KycFeedback]), ScopeModule],
  controllers: [KycFeedbackController],
  providers: [KycFeedbackService],
  exports: [KycFeedbackService],
})
export class KycFeedbackModule {}
