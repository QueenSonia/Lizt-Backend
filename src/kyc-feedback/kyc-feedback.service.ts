import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { KycFeedback } from './entities/kyc-feedback.entity';
import { CreateKycFeedbackDto } from './dto';
import { ManagementScopeService } from 'src/common/scope/management-scope.service';

@Injectable()
export class KycFeedbackService {
  constructor(
    @InjectRepository(KycFeedback)
    private feedbackRepo: Repository<KycFeedback>,
    private readonly scopeService: ManagementScopeService,
  ) {}

  async create(dto: CreateKycFeedbackDto) {
    // Feedback rates the KYC form experience, which belongs to the property
    // manager — attribute it to the managing admin (the landlord's creator_id)
    // so it surfaces in the admin's feedback views. Fall back to the landlord
    // id when no managing admin is set (pre-reparent / legacy links).
    const landlordId = dto.landlord_id;
    const managingAdminId = landlordId
      ? await this.scopeService.resolveManagingAdminId(landlordId)
      : null;
    const feedback = this.feedbackRepo.create({
      ...dto,
      landlord_id: managingAdminId ?? landlordId,
    });
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
