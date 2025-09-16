import { Repository } from "typeorm";
import { CacheService } from "src/lib/cache";
import { RolesEnum } from "src/base.entity";
import { Users } from "src/users/entities/user.entity";
import { ServiceRequest } from "src/service-requests/entities/service-request.entity";
import { PropertyTenant } from "src/properties/entities/property-tenants.entity";
import { WhatsappUtils } from "src/whatsapp-bot/utils/whatsapp";
import { ConfigService } from "@nestjs/config";

export class LandlordInteractive {
        private whatsappUtil: WhatsappUtils
  constructor(
    private usersRepo: Repository<Users>,
    private serviceRequestRepo: Repository<ServiceRequest>,
    private propertyTenantRepo: Repository<PropertyTenant>,
    private cache: CacheService,
  ) {
      const config = new ConfigService();
    this.whatsappUtil = new WhatsappUtils(config);
  }

  async handle(message: any, from: string) {
    const buttonReply = message.interactive?.button_reply;
    if (!buttonReply) return;

    const handlers: Record<string, () => Promise<void>> = {
      view_tenancies: () => this.handleViewTenancies(from),
      view_maintenance: () => this.handleViewMaintenance(from),
      new_tenant: () => this.handleNewTenant(from),
    };

    const handler = handlers[buttonReply.id];
    if (handler) {
      await handler();
    } else {
      await this.handleFallback(from, buttonReply.id);
    }
  }

  private async handleViewTenancies(from: string) {
    const ownerUser = await this.usersRepo.findOne({
      where: { phone_number: `${from}`, role: RolesEnum.LANDLORD },
      relations: ["accounts"],
    });

    if (!ownerUser) {
      await this.whatsappUtil.sendText(from, "No tenancy info available.");
      return;
    }

    const propertyTenants = await this.propertyTenantRepo.find({
      where: { property: { owner_id: ownerUser.accounts[0].id } },
      relations: ["property", "property.rents", "tenant", "tenant.user"],
    });

    if (!propertyTenants?.length) {
      await this.whatsappUtil.sendText(from, "No tenancies found.");
      return;
    }

    let tenancyMessage = "Here are your current tenancies:\n";
    for (const [i, pt] of propertyTenants.entries()) {
      const latestRent = pt.property.rents?.[pt.property.rents.length - 1] || null;
      const tenantName = pt.tenant?.user
        ? `${pt.tenant.user.first_name} ${pt.tenant.user.last_name}`
        : "Vacant";

      const rentAmount = latestRent?.rental_price
        ? latestRent.rental_price.toLocaleString("en-NG", {
            style: "currency",
            currency: "NGN",
          })
        : "N/A";

      const dueDate = latestRent?.lease_end_date
        ? new Date(latestRent.lease_end_date).toLocaleDateString("en-NG", {
            year: "numeric",
            month: "short",
            day: "numeric",
          })
        : "N/A";

      tenancyMessage += `${i + 1}. ${pt.property.name}\n${tenantName}\n${rentAmount}/yr\nNext rent due: ${dueDate}\n\n`;
    }

    await this.whatsappUtil.sendText(from, tenancyMessage);
    await this.whatsappUtil.sendText(
      from,
      "Reply with the number of the tenancy you want to view (e.g., 1 for first property)."
    );

    await this.cache.set(
      `service_request_state_landlord_${from}`,
      JSON.stringify({
        type: "tenancy",
        ids: propertyTenants.map((pt) => pt.id),
        step: "no_step",
        data: {},
      }),
      300
    );
  }

  private async handleViewMaintenance(from: string) {
    const ownerUser = await this.usersRepo.findOne({
      where: { phone_number: `${from}`, role: RolesEnum.LANDLORD },
      relations: ["accounts"],
    });

    if (!ownerUser) {
      await this.whatsappUtil.sendText(from, "No maintenance info available.");
      return;
    }

    const serviceRequests = await this.serviceRequestRepo.find({
      where: { property: { owner_id: ownerUser.accounts[0].id } },
      relations: ["property", "tenant", "tenant.user", "facilityManager", "notification"],
      order: { date_reported: "DESC" },
    });

    if (!serviceRequests?.length) {
      await this.whatsappUtil.sendText(from, "No maintenance requests found.");
      return;
    }

    let maintenanceMessage = "Here are open maintenance requests:\n";
    for (const [i, req] of serviceRequests.entries()) {
      const reportedDate = new Date(req.date_reported).toLocaleDateString("en-NG", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });

      maintenanceMessage += `${i + 1}. ${req.property_name} – ${req.issue_category} – Reported ${reportedDate} – Status: ${req.status}\n`;
    }

    await this.whatsappUtil.sendText(from, maintenanceMessage);
    await this.whatsappUtil.sendText(from, "Reply with the number of the request you want to view.");

    await this.cache.set(
      `service_request_state_landlord_${from}`,
      JSON.stringify({
        type: "maintenance",
        ids: serviceRequests.map((req) => req.id),
        step: "no_step",
        data: {},
      }),
      300
    );
  }

  private async handleNewTenant(from: string) {
    // delegate to flow
    await this.whatsappUtil.sendText(from, "Starting tenant onboarding...");
    // You can call flow.startAddTenantFlow(from) here
  }

  private async handleFallback(from: string, id: string) {
    await this.whatsappUtil.sendText(
      from,
      `Got it! You selected ${id}. Before we connect you with our team, may we have your full name?`
    );
    await this.cache.set(
      `service_request_state_default_${from}`,
      `property_owner_options_${id}`,
      300
    );
  }
}
