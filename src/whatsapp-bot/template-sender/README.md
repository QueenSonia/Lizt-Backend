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
- Quick-reply: `Quick reply` with payload `mr_chat_quick_reply:{request_id}` (varchar) — captured in `LandlordFlow.handleInteractive`, which sets a 10-min `chat_awaiting_reply_{phone}` cache state. The user's next inbound text is then posted to the thread via `ChatService.sendMaintenanceChatMessage` and the state is cleared.

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
