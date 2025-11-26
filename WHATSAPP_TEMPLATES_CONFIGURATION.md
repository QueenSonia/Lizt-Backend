# WhatsApp Templates Configuration

This document contains the exact configuration for all WhatsApp templates used in the system.

---

## Template 1: Landlord Main Menu

### Template Details

- **Template Name:** `landlord_main_menu`
- **Category:** UTILITY
- **Language:** English (en)
- **Status:** ✅ Approved

### Template Body

```
Hello {{1}}, What do you want to do today?
```

**Variables:**

- `{{1}}` = Landlord's name

### Buttons

**Button 1: URL Button**

- Type: Visit Website
- Button Text: `View Properties`
- Website URL: `https://www.lizt.co/landlord/properties`
- URL Type: Static

**Button 2: URL Button**

- Type: Visit Website
- Button Text: `Maintenance`
- Website URL: `https://www.lizt.co/landlord/service-requests`
- URL Type: Static

**Button 3: Quick Reply**

- Type: Quick Reply
- Button Text: `Generate KYC Link`

### Code Implementation

```typescript
// In WhatsappUtils or WhatsappBotService
async sendLandlordMainMenu(to: string, landlordName: string) {
  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: 'landlord_main_menu',
      language: {
        code: 'en',
      },
      components: [
        {
          type: 'body',
          parameters: [
            {
              type: 'text',
              text: landlordName,
            },
          ],
        },
        {
          type: 'button',
          sub_type: 'quick_reply',
          index: 2, // Third button (Generate KYC Link)
          parameters: [
            {
              type: 'payload',
              payload: 'generate_kyc_link',
            },
          ],
        },
      ],
    },
  };

  await this.sendToWhatsappAPI(payload);
}
```

---

## Template 2: Landlord Service Request Notification

### Template Details

- **Template Name:** `landlord_service_request_notification`
- **Category:** UTILITY
- **Language:** English (en)
- **Status:** ⏳ Needs to be created and approved

### Template Body

```
🛠️ New Service Request

Tenant: {{1}}
Property: {{2}}
Issue: {{3}}
Reported: {{4}}
```

**Variables:**

- `{{1}}` = Tenant name
- `{{2}}` = Property name
- `{{3}}` = Service request description
- `{{4}}` = Date created

### Buttons

**Button 1: URL Button**

- Type: Visit Website
- Button Text: `View All Requests`
- Website URL: `https://www.lizt.co/landlord/service-requests`
- URL Type: Static

### Code Implementation

```typescript
// In sendFacilityServiceRequest method
if (notificationRole === 'LANDLORD') {
  const payload = {
    messaging_product: 'whatsapp',
    to: phone_number,
    type: 'template',
    template: {
      name: 'landlord_service_request_notification',
      language: {
        code: 'en',
      },
      components: [
        {
          type: 'body',
          parameters: [
            {
              type: 'text',
              text: tenant_name, // {{1}}
            },
            {
              type: 'text',
              text: property_name, // {{2}}
            },
            {
              type: 'text',
              text: service_request, // {{3}}
            },
            {
              type: 'text',
              text: date_created, // {{4}}
            },
          ],
        },
      ],
    },
  };

  await this.sendToWhatsappAPI(payload);
  return;
}
```

---

## How to Create Template 2 in Meta Business Manager

### Step 1: Access Template Manager

1. Go to [Meta Business Manager](https://business.facebook.com/)
2. Navigate to **WhatsApp Manager**
3. Select your WhatsApp Business Account
4. Go to **Message Templates**
5. Click **Create Template**

### Step 2: Configure Template

**Template Name:**

```
landlord_service_request_notification
```

**Category:**
Select: **UTILITY**

**Language:**
Select: **English**

**Header:**
None (leave empty)

**Body:**

```
🛠️ New Service Request

Tenant: {{1}}
Property: {{2}}
Issue: {{3}}
Reported: {{4}}
```

**Footer:**
None (leave empty)

**Buttons:**
Add 1 button:

**Button 1: URL Button**

- Type: **Visit Website**
- Button Text: `View All Requests`
- Website URL: `https://www.lizt.co/landlord/service-requests`
- URL Type: **Static**

### Step 3: Submit for Approval

1. Review your template
2. Click **Submit**
3. Wait for Meta approval (usually 1-24 hours)

---

## Template Usage Summary

| Template Name                           | Used For                                        | Buttons               | Status      |
| --------------------------------------- | ----------------------------------------------- | --------------------- | ----------- |
| `landlord_main_menu`                    | Main menu after role selection or typing "menu" | 2 URL + 1 Quick Reply | ✅ Approved |
| `landlord_service_request_notification` | New service request notifications to landlords  | 1 URL                 | ⏳ Pending  |
| `fm_service_request_notification`       | New service request notifications to FMs        | 1 Quick Reply         | ✅ Existing |

---

## Testing Templates

### Test landlord_main_menu

```bash
curl -X POST "https://graph.facebook.com/v18.0/YOUR_PHONE_ID/messages" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "messaging_product": "whatsapp",
    "to": "YOUR_TEST_NUMBER",
    "type": "template",
    "template": {
      "name": "landlord_main_menu",
      "language": { "code": "en" },
      "components": [
        {
          "type": "body",
          "parameters": [{ "type": "text", "text": "John" }]
        },
        {
          "type": "button",
          "sub_type": "quick_reply",
          "index": 2,
          "parameters": [{ "type": "payload", "payload": "generate_kyc_link" }]
        }
      ]
    }
  }'
```

### Test landlord_service_request_notification

```bash
curl -X POST "https://graph.facebook.com/v18.0/YOUR_PHONE_ID/messages" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "messaging_product": "whatsapp",
    "to": "YOUR_TEST_NUMBER",
    "type": "template",
    "template": {
      "name": "landlord_service_request_notification",
      "language": { "code": "en" },
      "components": [
        {
          "type": "body",
          "parameters": [
            { "type": "text", "text": "John Doe" },
            { "type": "text", "text": "Golden Home" },
            { "type": "text", "text": "Bathroom tap leaking" },
            { "type": "text", "text": "Nov 26, 2025, 10:30 AM" }
          ]
        }
      ]
    }
  }'
```

---

## Troubleshooting

### Template Not Working

1. Verify template is approved in Meta Business Manager
2. Check template name matches exactly (case-sensitive)
3. Ensure all required parameters are provided
4. Check button index is correct (0-based)

### URL Button Not Redirecting

1. Verify URL is accessible and uses HTTPS
2. Test URL in browser first
3. Check URL is exactly as configured in template

### Quick Reply Button Not Working

1. Verify payload matches handler in code
2. Check button index is correct
3. Ensure handler is registered in landlordflow.ts

---

**Last Updated:** November 26, 2025
**Status:** Template 1 ✅ Complete | Template 2 ⏳ Needs approval
