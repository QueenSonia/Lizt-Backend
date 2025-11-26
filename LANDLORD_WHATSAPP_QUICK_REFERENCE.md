# Landlord WhatsApp Bot - Quick Reference

## Main Menu

When landlord types `menu`, they see:

```
Hello [Name], What do you want to do today?

[View properties] [Maintenance requests] [Generate KYC link]
```

---

## Button Actions

### 1. View Properties

**Action:** Opens web app  
**URL:** `https://www.lizt.co/landlord/properties`  
**Message:** "🏠 View your properties here: https://www.lizt.co/landlord/properties"

### 2. Maintenance Requests

**Action:** Opens web app  
**URL:** `https://www.lizt.co/landlord/service-requests`  
**Message:** "🛠️ View maintenance requests here: https://www.lizt.co/landlord/service-requests"

### 3. Generate KYC Link

**Action:** Starts KYC link generation flow  
**Steps:**

1. Shows property list
2. Landlord replies with number
3. Generates and sends KYC link

---

## Generate KYC Link Flow

### Example Interaction:

**Landlord:** _Clicks "Generate KYC link"_

**Bot:**

```
🏘️ Select a property to generate KYC link:

1. Golden Home
2. Silver Apartments

Reply with the number of the property.
```

**Landlord:** `1`

**Bot:**

```
✅ KYC link generated for *Golden Home*

🔗 https://www.lizt.co/kyc/abc123token

Share this link with potential tenants to complete their application.
```

---

## Service Request Notifications

When a tenant creates a service request, landlord receives:

```
🛠️ *New Service Request*

Tenant: John Doe
Property: Golden Home
Issue: Bathroom light not working
Reported: 25 Nov 2025, 10:29 AM

View all requests: https://www.lizt.co/landlord/service-requests
```

**Note:** No button - just a clickable link

---

## Special Commands

- **`menu`** - Show main menu
- **`done`** - Exit session
- **`switch role`** or **`switch`** - Clear role selection (for multi-role users)

---

## Error Messages

### No Properties

```
You do not have any properties yet. Please add properties on the web app first.
```

### Invalid Property Number

```
Invalid choice. Please reply with a valid number.
```

### Session Expired

```
⏱️ Your session has expired. Type "menu" to start over.
```

### Account Not Found

```
Account not found. Please try again.
```

---

## Implementation Notes

- All property/tenant management happens on web app
- WhatsApp is for quick notifications and KYC link sharing
- Session timeout: 5 minutes
- KYC links are generated using existing `/api/properties/:propertyId/kyc-link` endpoint
