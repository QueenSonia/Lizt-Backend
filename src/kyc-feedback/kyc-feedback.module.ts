import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KycFeedbackService } from './kyc-feedback.service';
import { KycFeedbackController } from './kyc-feedback.controller';
import { KycFeedback } from './entities/kyc-feedback.entity';

@Module({
  imports: [TypeOrmModule.forFeature([KycFeedback])],
  controllers: [KycFeedbackController],
  providers: [KycFeedbackService],
  exports: [KycFeedbackService],
})
export class KycFeedbackModule {}
