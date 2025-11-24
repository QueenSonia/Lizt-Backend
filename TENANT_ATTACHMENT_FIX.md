# Tenant Attachment Fix - Phone Number Normalization

## Problem

When attaching a tenant to a property, the system was throwing a duplicate key constraint error:

```
duplicate key value violates unique constraint "UQ_17d1817f241f10a3dbafb169fd2"
Key (phone_number)=(2347062639647) already exists.
```

This prevented landlords from attaching tenants who already existed in the system (e.g., a tenant who was previously attached to another landlord's property).

## Root Cause

The issue was caused by phone number format mismatch:

1. **KYC Application** stores phone numbers as entered by users: `07062639647`
2. **Users Table** stores normalized phone numbers with country code: `2347062639647`
3. The `Users` entity has `@BeforeInsert()` and `@BeforeUpdate()` hooks that automatically normalize phone numbers

When searching for existing users in `createOrGetTenantAccount()`, the code was comparing:

- Search query: `07062639647` (from KYC application)
- Database value: `2347062639647` (normalized)

This mismatch caused the search to fail, leading the system to attempt creating a new user with a phone number that already existed.

## Solution

Normalize the phone number **before** searching for existing users:

```typescript
// Normalize phone number to match database format
const normalizedPhone = application.phone_number
  ? this.utilService.normalizePhoneNumber(application.phone_number)
  : null;

// Use normalized phone when searching
existingUser = await manager.findOne(Users, {
  where: { phone_number: normalizedPhone },
});
```

## Changes Made

Updated `lizt-backend/src/kyc-links/tenant-attachment.service.ts`:

1. **Added phone normalization** at the start of `createOrGetTenantAccount()` method
2. **Updated user search** to use normalized phone number
3. **Updated user creation** to use normalized phone number
4. **Updated user updates** to use normalized phone number
5. **Added logging** to track original vs normalized phone numbers for debugging

## Impact

✅ **Tenants can now be attached to multiple landlords** - A user with phone `07062639647` can be a tenant for Landlord A and also be attached as a tenant for Landlord B

✅ **No duplicate users created** - The system correctly finds existing users and creates a new TENANT account for them instead of creating duplicate user records

✅ **Data integrity maintained** - Each landlord's tenant data remains independent through the Account/TenantKyc separation

## Architecture Note

The system supports multi-tenancy through:

- **Users table**: Stores the actual person (one record per person)
- **Account table**: Stores role-based access (one user can have multiple accounts with different roles)
- **TenantKyc table**: Stores landlord-specific tenant information (one record per user-landlord pair)

This allows a single person to:

- Be a tenant for multiple landlords (multiple TENANT accounts)
- Be both a landlord and a tenant (LANDLORD account + TENANT account)
- Have different KYC data stored per landlord relationship

## Testing

To verify the fix:

1. Create a KYC application for a tenant with phone `07062639647`
2. Attach the tenant to Landlord A's property
3. Create another KYC application for the same phone number
4. Attach the tenant to Landlord B's property
5. ✅ Should succeed without duplicate key errors
6. ✅ Both landlords should see the tenant in their respective dashboards
7. ✅ Only one user record should exist in the database
