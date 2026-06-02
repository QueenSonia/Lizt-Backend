# WhatsApp Template Sender Service

This service handles all WhatsApp template message sending operations for the Lizt platform.

## Renewal Templates

The following templates are configured for the tenancy renewal invoice flow:

### 1. renewal_link

**Purpose**: Send renewal link to tenant

**Template Name**: `renewal_link`

**Parameters**:

- `{{1}}` - Tenant name
- `{{2}}` - Property name
- `{{3}}` - Tenancy start date (e.g. `5 May 2026`)
- `{{4}}` - Tenancy end date (e.g. `4 May 2027`)

**Button**: URL button with renewal invoice link

**Message**:

```
Hi {{1}}, your renewal rent invoice for {{2}} is ready.

This invoice covers your tenancy from {{3}} to {{4}}.

You can safely view your invoice and make your payment using the link below.
```

**Usage**:

```typescript
await templateSenderService.sendRenewalLink({
  phone_number: '+2348012345678',
  tenant_name: 'John Doe',
  property_name: 'Lekki Gardens Apartment',
  start_date: '5 May 2026',
  end_date: '4 May 2027',
  renewal_token: 'abc123...',
  frontend_url: 'https://lizt.co',
});
```

### 2. renewal_payment_tenant

**Purpose**: Send payment confirmation to tenant

**Template Name**: `renewal_payment_tenant`

**Parameters**:

- `{{1}}` - Tenant name
- `{{2}}` - Payment amount (formatted with ₦)
- `{{3}}` - Property name

**Message**:

```
Congratulations {{1}}! Your renewal payment of {{2}} for {{3}} has been confirmed.

You can download your receipt from the renewal page.
```

**Usage**:

```typescript
await templateSenderService.sendRenewalPaymentTenant({
  phone_number: '+2348012345678',
  tenant_name: 'John Doe',
  amount: 500000,
  property_name: 'Lekki Gardens Apartment',
});
```

### 3. renewal_payment_landlord

**Purpose**: Send payment notification to landlord

**Template Name**: `renewal_payment_landlord`

**Parameters**:

- `{{1}}` - Landlord name
- `{{2}}` - Tenant name
- `{{3}}` - Payment amount (formatted with ₦)
- `{{4}}` - Property name

**Message**:

```
Hello {{1}}, {{2}} has completed their renewal payment of {{3}} for {{4}}.

The tenancy has been successfully renewed!
```

**Usage**:

```typescript
await templateSenderService.sendRenewalPaymentLandlord({
  phone_number: '+2348012345678',
  landlord_name: 'Jane Smith',
  tenant_name: 'John Doe',
  amount: 500000,
  property_name: 'Lekki Gardens Apartment',
});
```

### 4. tenancy_details_updated_tenant

**Purpose**: Notify tenant that their landlord has edited the active tenancy and prompt them to re-confirm

**Template Name**: `tenancy_details_updated_tenant`

**Parameters**:

- `{{1}}` - Tenant first name
- `{{2}}` - Property name

**Button**: Quick-reply button — `Confirm details` with payload `confirm_tenancy_details:{property_id}` (reuses the same dispatcher route as `welcome_tenant`, so a single tap takes the tenant to the Yes/No re-confirmation card)

**Message**:

```
Hi {{1}},

Your landlord has updated the tenancy details for {{2}}.

Please confirm your updated tenancy details.
```

**Usage**: Sent from `notifyTenantOfTenancyEdit` in `tenancies.service.ts` at the end of `updateActiveTenancy`, gated on `chargesChanged || periodOrFrequencyChanged || recurringChanges.length > 0` so no-op saves don't fire.

### 5. renewal_letter_signed

**Purpose**: Deliver the signed renewal-letter PDF to the tenant after they accept or decline. One template serves both outcomes — `outcome` flips the body verb while the rendered PDF carries the matching ACCEPTED/DECLINED stamp.

**Template Name**: `renewal_letter_signed`

**Parameters**:

- `{{1}}` - Tenant first name
- `{{2}}` - Property name
- `{{3}}` - Outcome verb (`accepted` or `declined`)
- `{{4}}` - Decision date (e.g. `May 29, 2026`)

**Header**: Document — the rendered letter PDF (`{ type: 'document', document: { link, filename } }`). Must be set to Document in the Meta registration, with a sample PDF.

**Message**:

```
Hi {{1}},

Your renewal letter for *{{2}}* has been *{{3}}* on {{4}}.

The signed copy is attached above for your records.
```

**Usage**: Sent from `dispatchSignedLetterPdf` in `renewal-letters.service.ts`, called from both the accept and decline paths (wrapped in try/catch so a Cloudinary/Meta failure never unwinds the accept/decline write). All four params are server-generated, so no `sanitizeTemplateParam` is required.

### 6. tenancy_renewed_from_credit

**Purpose**: Confirm to the tenant that their tenancy has been renewed and settled automatically from their wallet credit — no payment action on their part. Sent whenever a period is auto-renewed-and-paid from credit, both by the daily cron and by the landlord-triggered "renew now" action on the property-detail billing summary.

**Template Name**: `tenancy_renewed_from_credit`

**Parameters**:

- `{{1}}` - Tenant first name
- `{{2}}` - Period start (e.g. `May 12, 2026`)
- `{{3}}` - Period end (e.g. `Jun 11, 2026`)
- `{{4}}` - Rent amount, bare number (the `₦` is literal in the body), e.g. `250,000`
- `{{5}}` - Payment frequency (e.g. `Monthly`)
- `{{6}}` - Service charge, bare number, e.g. `60,000`

**Button**: None (body-only).

**Message**:

```
Congratulations {{1}}!

Your tenancy has been renewed.

Here are your updated tenancy details:
Tenancy period: {{2}} - {{3}}
Rent amount: ₦{{4}} {{5}}
Service charge: ₦{{6}}

Thank you.
```

**Usage**: `RenewalChargeService.renewOneFromWalletCredit` builds the params (via `buildTenancyRenewedParams`) and returns them as `renewedConfirmation` when the new period is covered by wallet credit; the callers — `RentReminderService` (cron) and `TenanciesService.renewFromWalletCreditNow` (the "renew now" endpoint) — queue them as `whatsAppNotificationLogService.queue('sendTenancyRenewedFromCredit', ...)`. The helper itself has no whatsapp dependency, to avoid a `RenewalChargeModule ↔ WhatsappBotModule` cycle. All six params are server-generated and pre-formatted, so no `sanitizeTemplateParam` is required.

### 7. landlord_renewal_review

**Purpose**: Give the landlord a one-day head start before their tenant's first renewal reminder for the cycle, so they can review/adjust the next period's figures before the tenant is notified. Sent for all frequencies.

**Template Name**: `landlord_renewal_review`

**Parameters**:

- `{{1}}` - Landlord display name (`accounts.profile_name`, first+last fallback)
- `{{2}}` - Tenant full name
- `{{3}}` - Property name
- `{{4}}` - Next period (e.g. `Jun 12, 2026 - Jul 11, 2026`)
- `{{5}}` - Next period rent (e.g. `₦250,000.00`)
- `{{6}}` - Next period service charge (e.g. `₦60,000.00`)
- `{{7}}` - Expected from tenant after wallet credit (e.g. `₦0.00` when fully covered)
- `{{8}}` - Status sentence: when fully covered, notes that NO payment reminder will be sent and when it auto-renews (monthly: on the next-period start date; non-monthly: once the tenant accepts the letter); otherwise "Your tenant's first renewal reminder goes out tomorrow." — i.e. the "goes out tomorrow" claim only appears when a reminder will actually be sent

**Button**: URL — "Review". Base URL `https://<frontend>/landlord/renew-tenancy/{{1}}`; the dynamic variable (`review_path`) is the bare `<propertyId>` (Meta requires the dynamic part to come last and be clean — no query string). The `renew-tenancy/<id>` route forwards to `/landlord/property-detail/<id>?action=renew`, opening the Renew Tenancy screen.

**Message**:

```
Hi {{1}},

Your tenant {{2}} at {{3}} is coming up for renewal.

Next period: {{4}}
Rent: {{5}}
Service charge: {{6}}
Expected from tenant: {{7}}

{{8}}

Review or adjust these details now using the button below.
```

**Usage**: Queued from `RentReminderService.sendLandlordReviewNotice` (cron step `processLandlordReviewNotices`), `max(schedule)+1` days before expiry per frequency (monthly 15, quarterly 31, bi-annually 91, annually 181). Also writes an in-app `RENEWAL_REVIEW_DUE` NotificationService entry. All params are server-generated, so no `sanitizeTemplateParam` is required.

## Maintenance Request Chat Templates

### 1. mr_new_chat_message

**Purpose**: Notify a landlord or facility manager that a new chat message landed on a maintenance-request's Updates & Thread.

**Template Name**: `mr_new_chat_message`

**Parameters**:

- `{{1}}` - Recipient first name
- `{{2}}` - Sender display name
- `{{3}}` - Request description excerpt (short — e.g. `Pipe leak in kitchen`). Must be sanitized via `UtilService.sanitizeTemplateParam(value, 60)` at the caller — it's free-text from the MR creator.
- `{{4}}` - Property or common-area name
- `{{5}}` - Message preview (free-text, must be sanitized via `UtilService.sanitizeTemplateParam(value, 220)` at the caller)

**Buttons**:

- URL button: `Open chat` → `https://lizt.co/r/mr/{{1}}` where `{{1}}` is the MR UUID. Routes through a small smart-router page (`/r/mr/[id]`) that detects the viewer's role and redirects them to `/landlord/facility?openMr={uuid}` or `/facility-manager/dashboard?openMr={uuid}` — the per-role page reads the query param and auto-opens the modal, then strips the param.
- Quick-reply: `Quick reply` with payload `mr_chat_quick_reply:{request_id}` (varchar) — captured in `LandlordFlow.handleInteractive`, which sets a 10-min `chat_awaiting_reply_{phone}` cache state. The user's next inbound text is then posted to the thread via `ChatService.sendMaintenanceChatMessage` and the state is cleared. Because this template lands on FMs too, the FM handlers (`LandlordFlowService.handleFacilityInteractive` / `handleFacilityText`) route the button and the follow-up text through `LandlordFlow.startMrChatQuickReply` / `tryConsumeMrChatReply` so an FM recipient isn't met with "Unknown option selected."

**Message**:

```
Hi {{1}},

{{2}} sent a message on "{{3}}" ({{4}}):

"{{5}}"

Tap "Open chat" to view the full thread, or "Quick reply" to respond from here.
```

**Usage**: Sole caller is `MrChatNotificationService` (lizt-backend/src/whatsapp-bot/mr-chat-notification.service.ts), which subscribes to `mr-chat.message.created` and ALWAYS sends the template to the landlord and assigned FM (minus the author). Presence on the chat gateway is not consulted — the two parties of the assignment always get a durable WhatsApp ping. An in-app `mr-chat.toast` event is emitted in parallel for live dashboard awareness; the frontend dedupes that toast against the currently-focused MR. Write access to the thread is itself private to these two parties — see `ChatService.resolveWriteRole`.

## Configuration

### Simulator Mode

For development and testing, set `WHATSAPP_SIMULATOR=true` in your `.env` file. This enables simulator mode where WhatsApp messages are logged but not actually sent to the WhatsApp API.

```env
WHATSAPP_SIMULATOR=true
```

### Production Mode

For production, ensure the following environment variables are set:

```env
WHATSAPP_SIMULATOR=false
WA_PHONE_NUMBER_ID=your_phone_number_id
CLOUD_API_ACCESS_TOKEN=your_access_token
```

## Template Registration

All templates must be registered and approved in the Meta Business Manager before they can be used in production. The templates are defined in the `TEMPLATE_CONTENT_MAP` constant in `template-sender.service.ts`.

## Requirements Mapping

- **Requirements 1.4, 1.5**: renewal_link template for sending renewal links
- **Requirements 2.1-2.3**: Template configuration for simulator environment
- **Requirements 7.1, 7.3**: renewal_payment_tenant template for tenant notifications
- **Requirements 7.2, 7.4**: renewal_payment_landlord template for landlord notifications
