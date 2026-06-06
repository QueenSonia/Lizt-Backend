import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { CacheService } from 'src/lib/cache';

/**
 * Opaque, short-lived token carried by a tenant maintenance Flow. The token
 * value is meaningless on its own; the payload lives in Redis keyed by it.
 *
 * - `create`: launching a brand-new maintenance request. Carries the tenant
 *   and the properties they may file against (drives the in-flow dropdown).
 * - `reopen`: relaunched after a tenant declines a resolution. Bound to the
 *   existing request + the report cycle the new evidence belongs to.
 */
/** A property the tenant may file against, shaped for the in-flow dropdown. */
export interface FlowProperty {
  id: string;
  title: string;
}

export type FlowTokenPayload =
  | {
      mode: 'create';
      /** Sender's WhatsApp number — the Flow endpoint doesn't echo it back. */
      phone: string;
      /** Users.id (createMaintenanceRequest keys the tenant off this). */
      tenant_user_id: string;
      properties: FlowProperty[];
      /**
       * The tenant's original stray message, when the flow was launched from the
       * "Add details" choice. Prepended to whatever they type in the flow so the
       * logged request keeps the first message. Absent for menu-launched flows.
       */
      seed_description?: string;
    }
  | {
      mode: 'reopen';
      phone: string;
      tenant_user_id: string;
      /** MaintenanceRequest.id (uuid) of the request being reopened. */
      request_id: string;
      /** Report cycle the new evidence belongs to. */
      attempt: number;
    };

const FLOW_TOKEN_TTL_SECONDS = 1800; // 30 minutes
const keyFor = (token: string) => `flow_token_${token}`;

@Injectable()
export class FlowTokenService {
  constructor(private readonly cache: CacheService) {}

  /** Mint a token and stash its payload in Redis. Returns the token string. */
  async mint(payload: FlowTokenPayload): Promise<string> {
    const token = randomUUID();
    await this.cache.setWithTtlSeconds(
      keyFor(token),
      payload,
      FLOW_TOKEN_TTL_SECONDS,
    );
    return token;
  }

  /** Resolve a token to its payload, or undefined if unknown/expired. */
  async resolve(token: string): Promise<FlowTokenPayload | undefined> {
    if (!token) return undefined;
    return this.cache.get<FlowTokenPayload>(keyFor(token));
  }

  /** Invalidate a token (e.g. after a terminal submit, to block replays). */
  async consume(token: string): Promise<void> {
    if (!token) return;
    await this.cache.delete(keyFor(token));
  }
}
