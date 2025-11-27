# KYC Link System - Quick Reference

## How It Works Now

### Link Generation

```
Landlord clicks "Generate KYC Link"
    ↓
System checks if property is VACANT
    ↓
System checks for existing active link
    ↓
Returns existing link OR creates new one
    ↓
Link has NO expiration date (expiresAt: null)
```

### Link Lifecycle

```
ACTIVE → Property becomes OCCUPIED → DEACTIVATED
ACTIVE → Landlord manually deactivates → DEACTIVATED
ACTIVE → Property deleted → DEACTIVATED
```

### Link Validation

```
Tenant opens KYC link
    ↓
System checks: Is link active?
    ↓
System checks: Is property still VACANT?
    ↓
If YES → Show KYC form
If NO → Show "Property no longer available"
```

## Key Points

✅ **No Time Expiration** - Links never expire based on time
✅ **Property Status Driven** - Links deactivate when property becomes occupied
✅ **Reusable** - Same link can be shared multiple times
✅ **Automatic Cleanup** - Links auto-deactivate when tenant is attached

## API Responses

### Generate KYC Link

```json
{
  "success": true,
  "message": "KYC link generated successfully",
  "data": {
    "token": "49a3137a-fbdd-434f-a82a-b0faeaab4ee7",
    "link": "https://lizt.co/kyc/49a3137a-fbdd-434f-a82a-b0faeaab4ee7",
    "expiresAt": null,
    "propertyId": "property-uuid"
  }
}
```

### WhatsApp Message

```
✅ KYC link for *Property Name*

🔗 https://lizt.co/kyc/token

🔄 This link remains active until the property is rented

Share this link with potential tenants to complete their application.
```

## Database Schema

```sql
CREATE TABLE kyc_links (
  id UUID PRIMARY KEY,
  token UUID UNIQUE NOT NULL,
  property_id UUID NOT NULL,
  landlord_id UUID NOT NULL,
  expires_at TIMESTAMP NULL,  -- Now nullable
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

## Common Scenarios

### Scenario 1: First Time Generation

```
Property: VACANT
Existing Link: None
Result: New link created with expiresAt = null
```

### Scenario 2: Regeneration

```
Property: VACANT
Existing Link: Active
Result: Same link returned (no new link created)
```

### Scenario 3: Tenant Attached

```
Property: VACANT → OCCUPIED
Existing Link: Active → Deactivated
Result: Link no longer works
```

### Scenario 4: Property Becomes Vacant Again

```
Property: OCCUPIED → VACANT
Old Link: Deactivated (stays deactivated)
Result: Landlord must generate new link
```

## Troubleshooting

### Link Not Working?

1. Check if property is still VACANT
2. Check if link is still active (`is_active = true`)
3. Check if property still exists

### Link Shows "Property No Longer Available"?

- Property status changed to OCCUPIED
- Link was manually deactivated
- Property was deleted

### Want to Invalidate a Link?

- Manually set `is_active = false` in database
- Or attach a tenant (auto-deactivates)

## Code Examples

### Generate Link (Backend)

```typescript
const result = await kycLinksService.generateKYCLink(propertyId, landlordId);
// result.expiresAt will be null
```

### Validate Link (Backend)

```typescript
const validation = await kycLinksService.validateKYCToken(token);
if (validation.valid) {
  // Show KYC form
} else {
  // Show error: validation.error
}
```

### Generate Link (Frontend)

```typescript
const response = await KYCService.generateKYCLink(propertyId);
// response.expiresAt will be null
```

## Migration Status

✅ Database migration created
✅ Code updated
✅ Tests updated
⏳ Pending: Run migration in production

---

**Last Updated:** November 26, 2025
