import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaystackGateway } from './paystack.gateway';
import { MonnifyGateway } from './monnify.gateway';
import {
  GatewayReferenceNotFoundError,
  PaymentGateway,
  VerifyPaymentResult,
} from './payment-gateway.interface';

/**
 * Holds every registered gateway adapter and resolves:
 *  - the ACTIVE gateway (env PAYMENT_GATEWAY) — all new initializations;
 *  - any gateway by name — row-backed verifies use the row's `gateway` column;
 *  - verify-by-reference with legacy fallback — for lanes that persist nothing
 *    at init (renewal / installment / payoff / ad-hoc), where the frontend
 *    only hands back a reference.
 */
@Injectable()
export class GatewayRegistryService {
  private readonly logger = new Logger(GatewayRegistryService.name);
  private readonly gateways = new Map<string, PaymentGateway>();

  constructor(
    private readonly configService: ConfigService,
    paystackGateway: PaystackGateway,
    monnifyGateway: MonnifyGateway,
  ) {
    this.register(paystackGateway);
    this.register(monnifyGateway);
  }

  register(gateway: PaymentGateway): void {
    this.gateways.set(gateway.name, gateway);
  }

  names(): string[] {
    return [...this.gateways.keys()];
  }

  get(name: string): PaymentGateway {
    const gateway = this.gateways.get(name);
    if (!gateway) {
      throw new Error(
        `Unknown payment gateway "${name}" (registered: ${this.names().join(', ')})`,
      );
    }
    return gateway;
  }

  /**
   * The gateway all NEW payments initialize through. Driven by the
   * PAYMENT_GATEWAY env var (production sets it to 'monnify' — see
   * .env.example and ROLLOUT.md).
   *
   * The code fallback is deliberately 'paystack', NOT 'monnify': an
   * environment that hasn't set PAYMENT_GATEWAY yet (or a fresh deploy before
   * the cutover) falls back to the already-configured legacy gateway rather
   * than 503-ing every payment against un-provisioned Monnify creds. Flipping
   * this fallback to 'monnify' is a one-line change once Monnify is the
   * permanent default and Paystack is being retired.
   */
  active(): PaymentGateway {
    const name =
      this.configService.get<string>('PAYMENT_GATEWAY') ?? 'paystack';
    return this.get(name);
  }

  /**
   * Verify a bare reference when no DB row records which gateway issued it:
   * try the active gateway first; on a definitive "never saw this reference"
   * fall back through every other registered adapter (covers users mid-
   * checkout across the cutover deploy and old webhook-retry stragglers).
   * Transient errors (network/5xx/auth) propagate immediately — only the
   * typed not-found error triggers fallback.
   */
  async verifyByReference(reference: string): Promise<VerifyPaymentResult> {
    const active = this.active();
    try {
      return await active.verifyPayment(reference);
    } catch (error) {
      if (!(error instanceof GatewayReferenceNotFoundError)) throw error;

      for (const gateway of this.gateways.values()) {
        if (gateway.name === active.name) continue;
        try {
          const result = await gateway.verifyPayment(reference);
          this.logger.log(
            `Reference ${reference} not on active gateway (${active.name}); resolved via legacy gateway ${gateway.name}`,
          );
          return result;
        } catch (inner) {
          if (!(inner instanceof GatewayReferenceNotFoundError)) throw inner;
        }
      }
      throw error;
    }
  }
}
