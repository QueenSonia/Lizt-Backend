import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as webpush from 'web-push';
import { PushSubscription } from './entities/push-subscription.entity';

@Injectable()
export class PushNotificationService {
    private readonly logger = new Logger(PushNotificationService.name);

    constructor(
        @InjectRepository(PushSubscription)
        private readonly pushSubscriptionRepository: Repository<PushSubscription>,
    ) {
        // Keys should be in environment variables in production
        // I will set them here temporarily or fetch from env
        webpush.setVapidDetails(
            'mailto:support@lizt.co',
            process.env.VAPID_PUBLIC_KEY || 'BOf2JyymmRn82GdlqLqPKh698u4_5xou-wtXeHmrRtZszI8QcE_eVFihN2ALKK2dL1c8sBz6MkaEd0i1zjILj10',
            process.env.VAPID_PRIVATE_KEY || 'pfFd2AjJFYu3W8v6vKorpZLPxJbpv0ExSfB_dzUvIfU',
        );
    }

    async subscribe(
        userId: string,
        subscription: webpush.PushSubscription,
    ): Promise<PushSubscription> {
        // Check if subscription already exists for this endpoint
        let existing = await this.pushSubscriptionRepository.findOne({
            where: { endpoint: subscription.endpoint },
        });

        if (existing) {
            if (existing.user_id !== userId) {
                existing.user_id = userId;
                existing = await this.pushSubscriptionRepository.save(existing);
            }
            return existing;
        }

        const newSub = this.pushSubscriptionRepository.create({
            user_id: userId,
            endpoint: subscription.endpoint,
            p256dh: subscription.keys.p256dh,
            auth: subscription.keys.auth,
        });

        this.logger.log(`New push subscription for user ${userId}`);
        return await this.pushSubscriptionRepository.save(newSub);
    }

    async sendToUser(userId: string, payload: any) {
        try {
            const subscriptions = await this.pushSubscriptionRepository.find({
                where: { user_id: userId },
            });

            if (subscriptions.length === 0) {
                return;
            }

            this.logger.log(
                `Sending push notification to user ${userId} (${subscriptions.length} devices)`,
            );

            const notificationPayload = JSON.stringify(payload);

            const promises = subscriptions.map(async (sub) => {
                try {
                    await webpush.sendNotification(
                        {
                            endpoint: sub.endpoint,
                            keys: { p256dh: sub.p256dh, auth: sub.auth },
                        },
                        notificationPayload,
                    );
                } catch (error) {
                    if (error.statusCode === 410 || error.statusCode === 404) {
                        // Subscription is invalid or expired
                        await this.pushSubscriptionRepository.delete(sub.id);
                        this.logger.log(`Removed expired subscription for user ${userId}`);
                    } else {
                        this.logger.error(`Error sending push to ${userId}:`, error);
                    }
                }
            });

            await Promise.all(promises);
        } catch (e) {
            this.logger.error('Failed to send push notifications', e);
        }
    }
}
