# WhatsApp Template Sender Service

This service handles all WhatsApp template message sending operations for the Lizt platform.

## Renewal Templates

The following templates are configured for the tenancy renewal invoice flow:

### 1. renewal_link

**Purpose**: Send renewal link to tenant

**Template Name**: `renewal_link`

**Parameters**:

- `{{1}}` - Tenant name

**Button**: URL button with renewal invoice link

**Message**:

```
Hi {{1}}, your landlord has initiated a tenancy renewal.

Please use the link below to view your renewal invoice and complete payment.
```

**Usage**:

```typescript
await templateSenderService.sendRenewalLink({
  phone_number: '+2348012345678',
  tenant_name: 'John Doe',
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
