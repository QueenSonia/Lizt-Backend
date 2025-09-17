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

  let parsed: { 
    type: "tenancy" | "maintenance" | "property_action"; 
    ids?: string[]; 
    step: string; 
    tenancyId?: string;
    occupied?: boolean;
  };

  try {
    parsed = raw
  } catch (err) {
    await this.whatsappUtil.sendText(from, "Something went wrong. Please try again.");
    return;
  }

  const choice = parseInt(text.trim(), 10);
  if (isNaN(choice)) {
    await this.whatsappUtil.sendText(from, "Invalid choice. Please reply with a valid number.");
    return;
  }

  // === 1. User is choosing from the tenancy list ===
  if (parsed.type === "tenancy" && parsed.step === "no_step") {
    if (!parsed.ids?.length || choice < 1 || choice > parsed.ids.length) {
      await this.whatsappUtil.sendText(from, "Invalid choice. Please reply with a valid number.");
      return;
    }
    const selectedId = parsed.ids[choice - 1];
    await this.handlePropertySelection(from, selectedId);
    return;
  }

  // === 2. User is choosing from property action menu ===
  if (parsed.type === "property_action" && parsed.step === "awaiting_action") {
    if (parsed.occupied) {
      switch (choice) {
        case 1:
          await this.showTenancyDetails(from, parsed.tenancyId!);
          break;
        case 2:
          await this.showMaintenanceList(from, parsed.tenancyId!);
          break;
        case 3:
          await this.startAddTenantFlow(from, parsed.tenancyId!);
          break;
        default:
          await this.whatsappUtil.sendText(from, "Invalid choice. Reply 1, 2, or 3.");
      }
    } else {
      switch (choice) {
        case 1:
          await this.startAddTenantFlow(from, parsed.tenancyId!);
          break;
        case 2:
          await this.showMaintenanceList(from, parsed.tenancyId!);
          break;
        default:
          await this.whatsappUtil.sendText(from, "Invalid choice. Reply 1 or 2.");
      }
    }
    return;
  }

  // === 3. User is choosing a maintenance request ===
  if (parsed.type === "maintenance" && parsed.step === "no_step") {
    if (!parsed.ids?.length || choice < 1 || choice > parsed.ids.length) {
      await this.whatsappUtil.sendText(from, "Invalid choice. Please reply with a valid number.");
      return;
    }
    const selectedId = parsed.ids[choice - 1];
    await this.showMaintenanceDetails(from, selectedId);
    return;
  }

  await this.whatsappUtil.sendText(from, "No active lookup. Please try again.");
}



private async handlePropertySelection(from: string, propertyId: string) {
  const tenancy = await this.propertyTenantRepo.findOne({
    where: { property_id: propertyId },
    relations: ['property', 'property.rents', 'tenant', 'tenant.user'],
  });

  if (!tenancy) {
    await this.whatsappUtil.sendText(from, 'Tenancy not found.');
    return;
  }

  const tenantName = tenancy.tenant?.user
    ? `${tenancy.tenant.user.first_name} ${tenancy.tenant.user.last_name}`
    : null;

  if (tenantName) {
    // Occupied Property Menu
    await this.whatsappUtil.sendText(
      from,
      `You selected ${tenancy.property.name} (Occupied by ${tenantName}). What would you like to do?\n
1. View Tenancy Details
2. View Maintenance Requests
3. Add a New Tenant (replaces existing)`,
    );

    await this.cache.set(
      this.key(from),
      JSON.stringify({
        type: 'property_action',
        tenancyId: tenancy.id,
        occupied: true,
        step: 'awaiting_action',
      }),
      300,
    );
  } else {
    // Vacant Property Menu
    await this.whatsappUtil.sendText(
      from,
      `You selected ${tenancy.property.name} (Vacant). What would you like to do?\n
1. Add a New Tenant
2. View Maintenance Requests`,
    );

    await this.cache.set(
      this.key(from),
      JSON.stringify({
        type: 'property_action',
        tenancyId: tenancy.id,
        occupied: false,
        step: 'awaiting_action',
      }),
      300,
    );
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

  private async showMaintenanceList(from: string, tenancyId: string) {
  const tenancy = await this.propertyTenantRepo.findOne({
    where: { id: tenancyId },
    relations: ["property"],
  });

  if (!tenancy) {
    await this.whatsappUtil.sendText(from, "Property not found.");
    return;
  }

  const requests = await this.serviceRequestRepo.find({
    where: { property_id: tenancy.property.id },
    order: { created_at: "DESC" },
  });

  if (!requests?.length) {
    await this.whatsappUtil.sendText(from, `No maintenance requests for ${tenancy.property.name}.`);
    return;
  }

  let message = `🛠 Maintenance Requests for ${tenancy.property.name}:\n`;
  requests.forEach((r, i) => {
    message += `${i + 1}. ${r.issue_category}\n${r.description}\n${r.status}\n`;
  });

  await this.whatsappUtil.sendText(from, message);
  await this.whatsappUtil.sendText(
    from,
    "Reply with the number of the request you want to view."
  );

  await this.cache.set(
    this.key(from),
    JSON.stringify({
      type: "maintenance",
      ids: requests.map((r) => r.id),
      step: "no_step",
    }),
    300
  );
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

  private async startAddTenantFlow(from: string, tenancyId: string) {
  await this.whatsappUtil.sendText(from, "Please enter tenant details (name, phone, etc).");
  
  await this.cache.set(
    this.key(from),
    JSON.stringify({
      type: "add_tenant",
      tenancyId,
      step: "awaiting_tenant_info",
    }),
    300
  );
}

}
