import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { KycFeedback } from './entities/kyc-feedback.entity';
import { CreateKycFeedbackDto } from './dto';

@Injectable()
export class KycFeedbackService {
  constructor(
    @InjectRepository(KycFeedback)
    private feedbackRepo: Repository<KycFeedback>,
  ) {}

  async create(dto: CreateKycFeedbackDto) {
    const feedback = this.feedbackRepo.create(dto);
    await this.feedbackRepo.save(feedback);

    return {
      success: true,
      message: 'Thank you for your feedback!',
    };
  }

  async findAll(landlord_id: string) {
    const feedbacks = await this.feedbackRepo.find({
      where: { landlord_id },
      order: { submitted_at: 'DESC' },
    });

    return { data: feedbacks };
  }

  async getStatistics(landlord_id: string) {
    const feedbacks = await this.feedbackRepo.find({
      where: { landlord_id },
    });

    const totalFeedbacks = feedbacks.length;
    const averageRating =
      totalFeedbacks > 0
        ? feedbacks.reduce((sum, f) => sum + f.rating, 0) / totalFeedbacks
        : 0;

    const ratingDistribution = {
      1: feedbacks.filter((f) => f.rating === 1).length,
      2: feedbacks.filter((f) => f.rating === 2).length,
      3: feedbacks.filter((f) => f.rating === 3).length,
      4: feedbacks.filter((f) => f.rating === 4).length,
      5: feedbacks.filter((f) => f.rating === 5).length,
    };

    const recentFeedbacks = feedbacks.slice(0, 10);

    return {
      totalFeedbacks,
      averageRating: parseFloat(averageRating.toFixed(2)),
      ratingDistribution,
      recentFeedbacks,
    };
  }

  async getAdminStatistics() {
    // Get ALL feedbacks regardless of landlord
    const feedbacks = await this.feedbackRepo.find({
      order: { submitted_at: 'DESC' },
    });

    const totalFeedbacks = feedbacks.length;
    const averageRating =
      totalFeedbacks > 0
        ? feedbacks.reduce((sum, f) => sum + f.rating, 0) / totalFeedbacks
        : 0;

    const ratingDistribution = {
      1: feedbacks.filter((f) => f.rating === 1).length,
      2: feedbacks.filter((f) => f.rating === 2).length,
      3: feedbacks.filter((f) => f.rating === 3).length,
      4: feedbacks.filter((f) => f.rating === 4).length,
      5: feedbacks.filter((f) => f.rating === 5).length,
    };

    const recentFeedbacks = feedbacks.slice(0, 50); // Show more for admin

    return {
      totalFeedbacks,
      averageRating: parseFloat(averageRating.toFixed(2)),
      ratingDistribution,
      recentFeedbacks,
    };
  }
}
