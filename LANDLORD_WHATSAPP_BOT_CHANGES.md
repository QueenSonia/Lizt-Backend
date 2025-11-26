# Landlord WhatsApp Bot Changes

## Summary

Updated the landlord WhatsApp bot flow to redirect to the web app for most actions and implemented KYC link generation via WhatsApp.

---

## Changes Made

### 1. Main Menu Buttons Updated

**Old Buttons:**

- View properties → Complex property browsing flow
- Maintenance requests → Complex request viewing flow
- Add new tenant → Multi-step tenant onboarding flow

**New Buttons:**

- **View properties** → Redirects to: `https://www.lizt.co/landlord/properties`
- **Maintenance requests** → Redirects to: `https://www.lizt.co/landlord/service-requests`
- **Generate KYC link** → New flow (see below)

---

### 2. Generate KYC Link Flow

**Step 1:** Landlord clicks "Generate KYC link" button

**Step 2:** Bot displays list of landlord's properties:

```
🏘️ Select a property to generate KYC link:

1. Golden Home
2. Silver Apartments

Reply with the number of the property.
```

**Step 3:** Landlord replies with property number (e.g., `1`)

**Step 4:** Bot generates KYC link and sends:

```
✅ KYC link generated for *Golden Home*

🔗 https://www.lizt.co/kyc/abc123token

Share this link with potential tenants to complete their application.
```

---

### 3. Service Request Notifications

**For Landlords:**

- Changed from template with button to simple text message with link
- Message format:

```
🛠️ *New Service Request*

Tenant: John Doe
Property: Golden Home
Issue: Bathroom light not working
Reported: 25 Nov 2025, 10:29 AM

View all requests: https://www.lizt.co/landlord/service-requests
```

**For Facility Managers:**

- Kept existing template with "View all service requests" button
- Button still triggers interactive flow

---

## Files Modified

### 1. `lizt-backend/src/whatsapp-bot/templates/landlord/landlordflow.ts`

- Updated `handleInteractive()` to redirect buttons to web app URLs
- Updated `handleText()` to only handle KYC link generation flow
- Added `KYCLinksService` injection

### 2. `lizt-backend/src/whatsapp-bot/templates/landlord/landlordlookup.ts`

- **Removed:** All property viewing, tenancy details, maintenance viewing, and tenant onboarding flows
- **Added:** `startGenerateKYCLinkFlow()` - Displays property list
- **Added:** `handleGenerateKYCLinkText()` - Handles property selection and generates KYC link
- **Updated:** `handleExitOrMenu()` - Shows updated main menu
- **Removed dependencies:** PropertyTenant, ServiceRequest, Rent repositories

### 3. `lizt-backend/src/whatsapp-bot/whatsapp-bot.service.ts`

- Updated landlord main menu buttons (lines 181-189)
- Modified `sendFacilityServiceRequest()` to check if recipient is landlord
  - If landlord: Sends text message with web link
  - If FM: Sends template with interactive button

### 4. `lizt-backend/src/whatsapp-bot/whatsapp-bot.module.ts`

- Added `KYCLinksModule` import

---

## Technical Implementation

### KYC Link Generation

```typescript
// 1. Fetch landlord's properties
const properties = await propertyRepo.find({
  where: { owner_id: landlord_account_id },
});

// 2. Generate KYC link using existing service
const kycLinkResponse = await kycLinksService.generateKYCLink(
  propertyId,
  landlordAccountId,
);

// 3. Build full URL
const kycLink = `${process.env.FRONTEND_URL}/kyc/${kycLinkResponse.token}`;
```

### Notification Role Detection

```typescript
// Store role when sending notification
await cache.set(`notification_role_${phone_number}`, 'LANDLORD', 24h);

// Check role when sending service request notification
const notificationRole = await cache.get(`notification_role_${phone_number}`);
if (notificationRole === 'LANDLORD') {
  // Send text with link
} else {
  // Send template with button
}
```

---

## Benefits

1. **Simplified WhatsApp Flow:** Landlords no longer navigate complex menus in WhatsApp
2. **Better UX:** Web app provides richer interface for viewing properties and requests
3. **Reduced Code Complexity:** Removed ~500 lines of unused landlord flow code
4. **KYC Link Sharing:** Landlords can easily generate and share KYC links via WhatsApp
5. **Consistent Experience:** All data viewing happens on web app, WhatsApp for quick actions

---

## Testing Checklist

- [ ] Landlord clicks "View properties" → Opens web app properties page
- [ ] Landlord clicks "Maintenance requests" → Opens web app service requests page
- [ ] Landlord clicks "Generate KYC link" → Shows property list
- [ ] Landlord selects property number → Receives KYC link
- [ ] Invalid property number → Shows error message
- [ ] Landlord with no properties → Shows appropriate message
- [ ] Service request notification to landlord → Includes web link
- [ ] Service request notification to FM → Shows button (unchanged)
- [ ] Type "menu" → Shows updated main menu
- [ ] Type "done" → Exits session

---

## Environment Variables Required

```env
FRONTEND_URL=https://www.lizt.co
```

---

## API Endpoints Used

- `POST /api/properties/:propertyId/kyc-link` - Generate KYC link (existing)
- Requires: Landlord authentication, property ownership validation

---

## Database Tables Accessed

**Read:**

- `users` - Landlord lookup
- `accounts` - Account verification
- `properties` - Property list for KYC link generation

**Write:**

- `kyc_links` - New KYC link record (via KYCLinksService)

**Cache (Redis):**

- `service_request_state_landlord_{phone}` - Flow state (5 min TTL)
- `selected_role_{phone}` - Role selection (24h TTL)
- `notification_role_{phone}` - Notification context (24h TTL)

---

## Migration Notes

**No database migrations required** - All changes are code-only.

**Backward Compatibility:**

- Existing landlord sessions will be cleared on next "menu" command
- No impact on tenant or FM flows
- Service request notifications work for both old and new flows

---

**Last Updated:** November 26, 2025
**Version:** 2.0
