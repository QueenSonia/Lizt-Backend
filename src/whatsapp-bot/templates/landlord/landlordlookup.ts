import { ConfigService } from "@nestjs/config";
import { CacheService } from "src/lib/cache";
import { PropertyTenant } from "src/properties/entities/property-tenants.entity";
import { ServiceRequest } from "src/service-requests/entities/service-request.entity";
import { WhatsappUtils } from "src/whatsapp-bot/utils/whatsapp";
import { Repository } from "typeorm/repository/Repository";

// --- landlordLookup.ts ---
export class LandlordLookup {
     private whatsappUtil: WhatsappUtils;
  constructor(
    private cache: CacheService,
      private propertyTenantRepo: Repository<PropertyTenant>,
    private serviceRequestRepo: Repository<ServiceRequest>,
  ) {
          const config = new ConfigService();
        this.whatsappUtil = new WhatsappUtils(config);
  }

  private key(from: string) {
    return `service_request_state_landlord_${from}`;
  }

  async handleLookup(from: string, text: string) {
    const raw = await this.cache.get(this.key(from));
    if (!raw) {
      await this.whatsappUtil.sendText(from, "No cached selection found. Please try again.");
      return;
    }

    let parsed: { type: "tenancy" | "maintenance"; ids: string[]; step: string };
    try {
      parsed = raw

      console.log({parsed})
    } catch (err) {
      await this.whatsappUtil.sendText(from, "Something went wrong. Please try again.");
      return;
    }

    if (parsed.step !== "select_item") {
      await this.whatsappUtil.sendText(from, "No active lookup. Please try again.");
      return;
    }

    const choice = parseInt(text.trim(), 10);
    if (isNaN(choice) || choice < 1 || choice > parsed.ids.length) {
      await this.whatsappUtil.sendText(from, "Invalid choice. Please reply with a valid number.");
      return;
    }

    const selectedId = parsed.ids[choice - 1];
    if (parsed.type === "tenancy") {
      await this.showTenancyDetails(from, selectedId);
    } else {
      await this.showMaintenanceDetails(from, selectedId);
    }
  }

  private async showTenancyDetails(from: string, tenancyId: string) {
    const tenancy = await this.propertyTenantRepo.findOne({
      where: { id: tenancyId },
      relations: ["property", "property.rents", "tenant", "tenant.user"],
    });

    if (!tenancy) {
      await this.whatsappUtil.sendText(from, "Tenancy not found.");
      return;
    }

    const latestRent = tenancy.property.rents?.at(-1) || null;
    const tenantName = tenancy.tenant?.user
      ? `${tenancy.tenant.user.first_name} ${tenancy.tenant.user.last_name}`
      : "Vacant";

    const paymentHistory =
      tenancy.property.rents
        ?.map(
          (r) =>
            `${new Date(r.lease_start_date).toLocaleDateString()} - ${r.amount_paid?.toLocaleString(
              "en-NG",
              { style: "currency", currency: "NGN" }
            )} (${r.payment_status})`
        )
        .join("\n") || "No payments yet";

    const details = `
🏠 Property: ${tenancy.property.name}
👤 Tenant: ${tenantName}
💵 Rent: ${latestRent?.rental_price?.toLocaleString("en-NG", {
      style: "currency",
      currency: "NGN",
    })}/yr
📅 Lease: ${latestRent?.lease_start_date?.toLocaleDateString()} → ${latestRent?.lease_end_date?.toLocaleDateString()}
⚖️ Outstanding: ${latestRent?.payment_status === "OWING" ? "Yes" : "No"}

📜 Payment History:
${paymentHistory}
    `;

    await this.whatsappUtil.sendText(from, details);
  }

  private async showMaintenanceDetails(from: string, requestId: string) {
    const maintenance = await this.serviceRequestRepo.findOne({
      where: { id: requestId },
      relations: ["property", "tenant", "tenant.user", "facilityManager", "notification"],
    });

    if (!maintenance) {
      await this.whatsappUtil.sendText(from, "Maintenance request not found.");
      return;
    }

    const reportedDate = new Date(maintenance.date_reported).toLocaleDateString("en-NG", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });

    const tenantName = maintenance.tenant?.user
      ? `${maintenance.tenant.user.first_name} ${maintenance.tenant.user.last_name}`
      : "Unknown";

    const details = `
🛠️ Maintenance Request
🏠 Property: ${maintenance.property?.name}
👤 Tenant: ${tenantName}
📅 Reported: ${reportedDate}
📂 Category: ${maintenance.issue_category}
📌 Status: ${maintenance.status}
🔧 Facility Manager: ${maintenance.facilityManager?.account.profile_name || "N/A"}
    `;

    await this.whatsappUtil.sendText(from, details);
  }
}
