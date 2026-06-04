import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { FileUploadService } from 'src/utils/cloudinary';
import { MediaItem } from 'src/maintenance-requests/dto/create-maintenance-request.dto';

/**
 * Encryption metadata that accompanies a Flow PhotoPicker/DocumentPicker
 * upload. All values are base64. Mirrors WhatsApp's standard media-encryption
 * scheme (AES-256-CBC + a 10-byte HMAC-SHA256 tail).
 */
export interface FlowMediaEncryptionMetadata {
  encryption_key: string;
  hmac_key: string;
  iv: string;
  encrypted_hash: string;
  plaintext_hash: string;
}

/**
 * A single media reference as delivered in a Flow `data_exchange` payload.
 * Real Meta uploads carry `cdn_url` + `encryption_metadata`; the in-house
 * simulator instead sends a pre-hosted public `link` (+ `type`), which is used
 * directly without download/decrypt.
 */
export interface FlowMediaRef {
  file_name?: string;
  cdn_url?: string;
  encryption_metadata?: FlowMediaEncryptionMetadata;
  link?: string;
  type?: 'image' | 'video';
}

@Injectable()
export class WhatsAppMediaService {
  private readonly logger = new Logger(WhatsAppMediaService.name);
  private readonly graphVersion = 'v19.0';

  constructor(
    private readonly config: ConfigService,
    private readonly fileUpload: FileUploadService,
  ) {}

  /**
   * Download an inbound WhatsApp media object (image/video) by its media id.
   * Meta requires two hops: a metadata GET that yields a short-lived `url`,
   * then a bytes GET against that url — both with the Cloud API bearer token.
   */
  async downloadInboundMedia(
    mediaId: string,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    const accessToken = this.config.get('CLOUD_API_ACCESS_TOKEN');
    if (!accessToken) {
      throw new Error('CLOUD_API_ACCESS_TOKEN is not configured.');
    }

    const metaRes = await fetch(
      `https://graph.facebook.com/${this.graphVersion}/${mediaId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const meta = (await metaRes.json()) as {
      url?: string;
      mime_type?: string;
      error?: unknown;
    };
    if (!metaRes.ok || !meta.url) {
      throw new Error(
        `Meta media metadata fetch failed (${metaRes.status}): ${JSON.stringify(
          meta.error ?? meta,
        )}`,
      );
    }

    const fileRes = await fetch(meta.url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!fileRes.ok) {
      throw new Error(`Meta media bytes fetch failed (${fileRes.status})`);
    }
    const buffer = Buffer.from(await fileRes.arrayBuffer());
    return { buffer, mimeType: meta.mime_type ?? 'application/octet-stream' };
  }

  /**
   * Download a Flow-uploaded (PhotoPicker/DocumentPicker) media item from its
   * CDN url and decrypt it. Media in Flows is encrypted at rest on Meta's CDN.
   */
  async downloadAndDecryptFlowMedia(
    ref: FlowMediaRef,
  ): Promise<{ buffer: Buffer }> {
    if (!ref.cdn_url || !ref.encryption_metadata) {
      throw new Error('Flow media ref is missing cdn_url/encryption_metadata');
    }
    const res = await fetch(ref.cdn_url);
    if (!res.ok) {
      throw new Error(`Flow media CDN fetch failed (${res.status})`);
    }
    const bundle = Buffer.from(await res.arrayBuffer());
    return { buffer: this.decryptFlowMedia(bundle, ref.encryption_metadata) };
  }

  /**
   * AES-256-CBC decrypt + integrity-verify a Flow media bundle.
   * Layout: `ciphertext || hmac[10]`. Verifies the SHA-256 of the whole bundle
   * against `encrypted_hash`, the HMAC-SHA256 of `iv||ciphertext` against the
   * 10-byte tail, and the SHA-256 of the plaintext against `plaintext_hash`.
   */
  private decryptFlowMedia(
    bundle: Buffer,
    meta: FlowMediaEncryptionMetadata,
  ): Buffer {
    const encryptionKey = Buffer.from(meta.encryption_key, 'base64');
    const hmacKey = Buffer.from(meta.hmac_key, 'base64');
    const iv = Buffer.from(meta.iv, 'base64');
    const encryptedHash = Buffer.from(meta.encrypted_hash, 'base64');
    const plaintextHash = Buffer.from(meta.plaintext_hash, 'base64');

    if (!crypto.createHash('sha256').update(bundle).digest().equals(encryptedHash)) {
      throw new Error('Flow media encrypted_hash mismatch');
    }

    const hmacTail = bundle.subarray(bundle.length - 10);
    const ciphertext = bundle.subarray(0, bundle.length - 10);
    const expectedHmac = crypto
      .createHmac('sha256', hmacKey)
      .update(Buffer.concat([iv, ciphertext]))
      .digest()
      .subarray(0, 10);
    if (!expectedHmac.equals(hmacTail)) {
      throw new Error('Flow media HMAC mismatch');
    }

    const decipher = crypto.createDecipheriv('aes-256-cbc', encryptionKey, iv);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);

    if (!crypto.createHash('sha256').update(plaintext).digest().equals(plaintextHash)) {
      throw new Error('Flow media plaintext_hash mismatch');
    }
    return plaintext;
  }

  /**
   * Upload a decoded media buffer to Cloudinary and return a MediaItem ready to
   * append to `issue_media` (caller supplies the `attempt`).
   */
  async uploadToCloud(
    buffer: Buffer,
    mimeType: string,
    attempt: number,
  ): Promise<MediaItem> {
    const type: MediaItem['type'] = mimeType.startsWith('video')
      ? 'video'
      : 'image';
    const result = await this.fileUpload.uploadMediaBuffer(buffer, {
      resourceType: type,
      folder: 'maintenance-requests',
    });
    return { type, url: result.secure_url, attempt };
  }
}
