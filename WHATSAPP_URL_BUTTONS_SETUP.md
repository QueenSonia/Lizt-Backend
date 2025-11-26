# WhatsApp URL Buttons Setup Guide

## Overview

To make WhatsApp buttons redirect directly to URLs instead of sending text links, you need to use **WhatsApp Message Templates** with URL buttons. These templates must be created and approved in Meta Business Manager.

---

## Why Templates Are Required

WhatsApp has two types of buttons:

1. **Interactive Buttons (Quick Reply)** - Currently used
   - ❌ Can only send text responses
   - ❌ Cannot redirect to URLs
   - ✅ No approval needed
   - ✅ Can be created dynamically in code

2. **Template Buttons (URL/Call-to-Action)** - What you need
   - ✅ Can redirect directly to URLs
   - ✅ Better user experience
   - ❌ Must be pre-approved by Meta
   - ❌ Cannot be created dynamically

---

## Step 1: Create Template in Meta Business Manager

### Access Template Manager

1. Go to [Meta Business Manager](https://business.facebook.com/)
2. Navigate to **WhatsApp Manager**
3. Select your WhatsApp Business Account
4. Go to **Message Templates**
5. Click **Create Template**

### Template Configuration

#### Template Name

```
landlord_main_menu
```

#### Category

Select: **UTILITY** (for account updates and notifications)

#### Language

Select: **English**

#### Header (Optional)

None needed

#### Body

```
Hello {{1}}, What do you want to do today?
```

**Variables:**

- `{{1}}` = Landlord's name

#### Footer (Optional)

```
Powered by Property Kraft
```

#### Buttons

Add 3 buttons:

**Button 1: URL Button**

- Type: **Visit Website**
- Button Text: `View Properties`
- Website URL: `https://www.lizt.co/landlord/properties`
- URL Type: **Static** (same for all users)

**Button 2: URL Button**

- Type: **Visit Website**
- Button Text: `Maintenance`
- Website URL: `https://www.lizt.co/landlord/service-requests`
- URL Type: **Static**

**Button 3: Quick Reply Button**

- Type: **Quick Reply**
- Button Text: `Generate KYC Link`

---

## Step 2: Submit for Approval

1. Review your template
2. Click **Submit**
3. Wait for Meta approval (usually 1-24 hours)
4. Check status in Message Templates section

**Note:** Templates are usually approved quickly if they follow Meta's guidelines.

---

## Step 3: Update Code to Use Template

Once approved, update the landlord menu to use the template:

### Option A: Update `landlordlookup.ts`

```typescript
async handleExitOrMenu(from: string, text: string) {
  if (text.toLowerCase() === 'done') {
    await this.whatsappUtil.sendText(
      from,
      'Thanks! You have exited landlord flow.',
    );
    await this.cache.delete(`service_request_state_landlord_${from}`);
  } else {
    const ownerUser = await this.usersRepo.findOne({
      where: { phone_number: `${from}`, role: RolesEnum.LANDLORD },
      relations: ['accounts'],
    });

    const landlordName = ownerUser?.accounts[0]?.profile_name ||
                         ownerUser?.first_name ||
                         'there';

    // Use template with URL buttons instead of interactive buttons
    await this.whatsappUtil.sendLandlordMainMenu(from, landlordName);
    return;
  }
}
```

### Option B: Add Method to WhatsappUtils

In `lizt-backend/src/whatsapp-bot/utils/whatsapp.ts`:

```typescript
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

## Step 4: Update Button Handlers

The URL buttons will open directly in the browser, so you can remove the text response handlers:

```typescript
const handlers: Record<string, () => Promise<void>> = {
  // Remove these - URL buttons handle them automatically
  // view_properties: () => ...
  // view_maintenance: () => ...

  // Keep only the quick reply button handler
  generate_kyc_link: () => this.lookup.startGenerateKYCLinkFlow(from),
};
```

---

## Alternative: Use Interactive List (No Approval Needed)

If you don't want to wait for template approval, you can use an **Interactive List** which supports URLs in the description:

```typescript
async sendLandlordMenuList(to: string, landlordName: string) {
  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      header: {
        type: 'text',
        text: 'Landlord Menu',
      },
      body: {
        text: `Hello ${landlordName}, What do you want to do today?`,
      },
      action: {
        button: 'View Options',
        sections: [
          {
            title: 'Quick Actions',
            rows: [
              {
                id: 'view_properties',
                title: 'View Properties',
                description: 'https://www.lizt.co/landlord/properties',
              },
              {
                id: 'view_maintenance',
                title: 'Maintenance',
                description: 'https://www.lizt.co/landlord/service-requests',
              },
              {
                id: 'generate_kyc_link',
                title: 'Generate KYC Link',
                description: 'Create a link for new tenants',
              },
            ],
          },
        ],
      },
    },
  };

  await this.sendToWhatsappAPI(payload);
}
```

**Note:** Interactive lists still require users to click the option, then the link is sent as text. It's not a direct redirect.

---

## Comparison

| Feature             | Interactive Buttons  | Template URL Buttons | Interactive List     |
| ------------------- | -------------------- | -------------------- | -------------------- |
| Direct URL redirect | ❌ No                | ✅ Yes               | ❌ No                |
| Approval required   | ❌ No                | ✅ Yes (1-24h)       | ❌ No                |
| Dynamic content     | ✅ Yes               | ⚠️ Limited           | ✅ Yes               |
| User experience     | 😐 Click → Text link | 😊 Click → Opens URL | 😐 Click → Text link |
| Setup complexity    | Easy                 | Medium               | Easy                 |

---

## Recommended Approach

### For Production (Best UX)

1. Create and get approval for `landlord_main_menu` template
2. Use URL buttons for "View Properties" and "Maintenance"
3. Use quick reply button for "Generate KYC Link"

### For Development/Testing

1. Keep current interactive buttons
2. Send text with clickable links
3. Switch to templates once approved

---

## Template Approval Tips

✅ **Do:**

- Use clear, professional language
- Keep button text short (max 20 characters)
- Use static URLs when possible
- Follow Meta's messaging policies

❌ **Don't:**

- Use promotional language
- Include prices or offers
- Use dynamic URLs without approval
- Violate WhatsApp Business Policy

---

## Testing

Once template is approved:

1. Send test message:

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
        }
      ]
    }
  }'
```

2. Verify:
   - ✅ Message appears correctly
   - ✅ URL buttons open correct pages
   - ✅ Quick reply button triggers handler

---

## Troubleshooting

### Template Rejected

- Check Meta's rejection reason
- Revise template following guidelines
- Resubmit

### Buttons Not Working

- Verify template is approved
- Check template name matches code
- Ensure button index is correct

### URLs Not Opening

- Verify URLs are accessible
- Check HTTPS is used
- Test URLs in browser first

---

## Resources

- [WhatsApp Business API Documentation](https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-messages)
- [Message Templates Guide](https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates)
- [WhatsApp Business Policy](https://www.whatsapp.com/legal/business-policy)

---

**Last Updated:** November 26, 2025
