import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { PaymentPlan } from '../entities/payment-plan.entity';
import { PaymentPlanRequest } from '../entities/payment-plan-request.entity';
import { PropertyHistory } from '../../property-history/entities/property-history.entity';
import { RenewalInvoice } from '../../tenancies/entities/renewal-invoice.entity';
import { Rent } from '../../rents/entities/rent.entity';
import { AdHocInvoice } from '../../ad-hoc-invoices/entities/ad-hoc-invoice.entity';
import { PropertyTenant } from '../../properties/entities/property-tenants.entity';
import { ManagementScopeService } from '../../common/scope/management-scope.service';

import { assembleTimeline } from './timeline-assembler';
import { PaymentPlanTimelineResponseDto } from './dto/payment-plan-timeline.dto';
import { todayBusinessKey } from './date-util';

/** Plan lifecycle + reminder history rows the timeline consumes. Request rows
 * are intentionally excluded — request dots are built from the request entities
 * (richer: decline reason, decided_at). */
const TIMELINE_EVENT_TYPES = [
  'payment_plan_created',
  'payment_plan_updated',
  'payment_plan_cancelled',
  'payment_plan_completed',
  'payment_plan_installment_paid',
  'payment_plan_installment_reminder_sent',
  'payment_plan_installment_overdue_sent',
];

@Injectable()
export class PaymentPlanTimelineService {
  private readonly logger = new Logger(PaymentPlanTimelineService.name);

  constructor(
    @InjectRepository(PaymentPlan)
    private readonly planRepository: Repository<PaymentPlan>,
    @InjectRepository(PaymentPlanRequest)
    private readonly requestRepository: Repository<PaymentPlanRequest>,
    @InjectRepository(PropertyHistory)
    private readonly propertyHistoryRepository: Repository<PropertyHistory>,
    @InjectRepository(RenewalInvoice)
    private readonly renewalInvoiceRepository: Repository<RenewalInvoice>,
    @InjectRepository(Rent)
    private readonly rentRepository: Repository<Rent>,
    @InjectRepository(AdHocInvoice)
    private readonly adHocInvoiceRepository: Repository<AdHocInvoice>,
    @InjectRepository(PropertyTenant)
    private readonly propertyTenantRepository: Repository<PropertyTenant>,
    private readonly scopeService: ManagementScopeService,
  ) {}

  async getTimeline(
    requesterUserId: string,
    propertyTenantId: string,
  ): Promise<PaymentPlanTimelineResponseDto> {
    // IDOR guard — same owner scope as listPlans. Resolve the tenancy and
    // confirm the requester may act for its landlord; otherwise an empty view.
    const propertyTenant = await this.propertyTenantRepository.findOne({
      where: { id: propertyTenantId },
      relations: ['property'],
    });
    if (!propertyTenant?.property) return { rows: [] };

    const managed =
      await this.scopeService.resolveManagedLandlordIds(requesterUserId);
    const ownerScope = new Set([requesterUserId, ...managed]);
    if (!ownerScope.has(propertyTenant.property.owner_id)) return { rows: [] };

    const propertyId = propertyTenant.property_id;
    const tenantId = propertyTenant.tenant_id;

    const [plans, requests, histories, rents] = await Promise.all([
      this.planRepository.find({
        where: { property_tenant_id: propertyTenantId },
        relations: ['installments'],
      }),
      this.requestRepository.find({
        where: { property_tenant_id: propertyTenantId },
      }),
      this.propertyHistoryRepository.find({
        where: {
          property_id: propertyId,
          tenant_id: tenantId,
          event_type: In(TIMELINE_EVENT_TYPES),
        },
        order: { created_at: 'ASC' },
      }),
      this.rentRepository.find({
        where: { property_id: propertyId, tenant_id: tenantId },
      }),
    ]);

    // Related invoices for titles + tenancy periods.
    const adHocIds = Array.from(
      new Set(
        plans
          .map((p) => p.ad_hoc_invoice_id)
          .filter((id): id is string => !!id),
      ),
    );
    const renewalIds = Array.from(
      new Set(
        [
          ...plans.map((p) => p.renewal_invoice_id),
          ...requests.map((r) => r.renewal_invoice_id),
        ].filter((id): id is string => !!id),
      ),
    );

    const [adHocInvoices, renewalInvoices] = await Promise.all([
      adHocIds.length
        ? this.adHocInvoiceRepository.find({
            where: { id: In(adHocIds) },
            relations: ['line_items'],
          })
        : Promise.resolve([]),
      renewalIds.length
        ? this.renewalInvoiceRepository.find({ where: { id: In(renewalIds) } })
        : Promise.resolve([]),
    ]);

    const { rows, unresolvedCount } = assembleTimeline({
      plans,
      requests,
      histories,
      adHocInvoicesById: new Map(adHocInvoices.map((i) => [i.id, i])),
      renewalInvoicesById: new Map(renewalInvoices.map((i) => [i.id, i])),
      rents,
      todayKey: todayBusinessKey(),
    });

    if (unresolvedCount > 0) {
      this.logger.debug(
        `Dropped ${unresolvedCount} unresolvable plan-history row(s) for property_tenant ${propertyTenantId}`,
      );
    }

    return { rows };
  }
}
