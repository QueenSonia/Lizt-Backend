import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OnEvent } from '@nestjs/event-emitter';
import { MaintenanceRequest } from 'src/maintenance-requests/entities/maintenance-request.entity';
import { MediaItem } from 'src/maintenance-requests/dto/create-maintenance-request.dto';
import {
  FlowMediaRef,
  WhatsAppMediaService,
} from './whatsapp-media.service';

/** Payload for the async Flow-media ingest event emitted from getNextScreen. */
export interface MaintenanceMediaIngestEvent {
  request_id: string;
  attempt: number;
  flowMedia: FlowMediaRef[];
}

const guessMimeFromName = (name?: string): string => {
  const ext = name?.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'mp4':
    case 'm4v':
      return 'video/mp4';
    case '3gp':
    case '3gpp':
      return 'video/3gpp';
    case 'mov':
      return 'video/quicktime';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    default:
      return 'image/jpeg';
  }
};

@Injectable()
export class MaintenanceMediaService {
  private readonly logger = new Logger(MaintenanceMediaService.name);

  constructor(
    @InjectRepository(MaintenanceRequest)
    private readonly requestRepository: Repository<MaintenanceRequest>,
    private readonly media: WhatsAppMediaService,
  ) {}

  /**
   * Append media to a request's `issue_media`, re-reading the row first so we
   * don't clobber attachments added concurrently (the Flow ingest and an
   * inbound video can race).
   */
  async appendMedia(requestId: string, items: MediaItem[]): Promise<void> {
    if (!items.length) return;
    const request = await this.requestRepository.findOne({
      where: { id: requestId },
    });
    if (!request) {
      this.logger.warn(`appendMedia: request ${requestId} not found`);
      return;
    }
    request.issue_media = [...(request.issue_media ?? []), ...items];
    await this.requestRepository.save(request);
  }

  /**
   * Async handler for Flow PhotoPicker uploads. Each item is downloaded from
   * Meta's CDN, decrypted, pushed to Cloudinary, then appended. Best-effort:
   * a single bad item is logged and skipped so the rest still land. Fired
   * (not awaited) from getNextScreen so the Flow response stays within Meta's
   * endpoint timeout.
   */
  @OnEvent('maintenance.media.ingest')
  async handleFlowMediaIngest(
    event: MaintenanceMediaIngestEvent,
  ): Promise<void> {
    const items: MediaItem[] = [];
    for (const ref of event.flowMedia ?? []) {
      try {
        // Simulator-provided media is already a public URL — use it directly.
        if (ref.link) {
          items.push({
            type: ref.type ?? 'image',
            url: ref.link,
            attempt: event.attempt,
          });
          continue;
        }
        const { buffer } = await this.media.downloadAndDecryptFlowMedia(ref);
        const item = await this.media.uploadToCloud(
          buffer,
          guessMimeFromName(ref.file_name),
          event.attempt,
        );
        items.push(item);
      } catch (err) {
        this.logger.error(
          `Failed to ingest flow media for request ${event.request_id}`,
          err as Error,
        );
      }
    }
    await this.appendMedia(event.request_id, items);
  }

  /**
   * Ingest a single inbound WhatsApp media item and append it to the request.
   * Real media (`id`) is downloaded from Meta and re-hosted on Cloudinary;
   * simulator media arrives as a pre-hosted public `link` and is used directly.
   * Returns the appended item, or null on failure. Awaited by the inbound-media
   * handler so it can confirm to the tenant.
   */
  async ingestInboundMedia(
    requestId: string,
    media: { id?: string; link?: string; type: 'image' | 'video' },
    attempt: number,
  ): Promise<MediaItem | null> {
    try {
      const item = await this.uploadStrayInbound(media, attempt);
      if (!item) return null;
      await this.appendMedia(requestId, [item]);
      return item;
    } catch (err) {
      this.logger.error(
        `Failed to ingest inbound media for request ${requestId}`,
        err as Error,
      );
      return null;
    }
  }

  /**
   * Download + re-host an inbound WhatsApp media item to Cloudinary WITHOUT
   * attaching it to any request — used by the tenant AI flow, which buffers
   * media before a maintenance request exists, then drains the buffer into
   * `issue_media` once the request is filed. Simulator `link` media is used
   * directly. Returns the `{type, url, attempt}` item, or null on failure.
   */
  async uploadStrayInbound(
    media: { id?: string; link?: string; type: 'image' | 'video' },
    attempt = 1,
  ): Promise<MediaItem | null> {
    try {
      if (media.link) {
        return { type: media.type, url: media.link, attempt };
      }
      if (!media.id) return null;
      const { buffer, mimeType } = await this.media.downloadInboundMedia(
        media.id,
      );
      return await this.media.uploadToCloud(buffer, mimeType, attempt);
    } catch (err) {
      this.logger.error('Failed to upload stray inbound media', err as Error);
      return null;
    }
  }
}
