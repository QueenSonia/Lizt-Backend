# KYC Link Expiration Removal - Implementation Summary

## Overview

Removed time-based expiration from KYC links. Links now remain active until property status changes, is manually deactivated, or property is deleted.

## Problem Statement

- Original system had 7-day expiration on KYC links
- User reported receiving expired links (Nov 21, 2025) when generating on Nov 26, 2025
- 7-day expiration was too restrictive for tenant application process
- Caused unnecessary friction for both landlords and tenants

## Solution Implemented

**Option B: Remove expiration, rely on property status**

KYC links now remain active until:

1. Property becomes OCCUPIED (tenant attached)
2. Landlord manually deactivates the link
3. Property is deleted

## Changes Made

### 1. Database Schema (`kyc_link.entity.ts`)

```typescript
// BEFORE
@Column({ type: 'timestamp' })
expires_at: Date;

// AFTER
@Column({ type: 'timestamp', nullable: true })
expires_at: Date;
```

### 2. KYC Links Service (`kyc-links.service.ts`)

#### Removed:

- `DEFAULT_EXPIRY_DAYS` constant
- Expiration date calculation in `generateKYCLink()`
- Expiration check in `validateKYCToken()`
- `deactivateExpiredKYCLinks()` method
- All expiration-related logic

#### Updated:

- `generateKYCLink()` - Returns `expiresAt: null`
- `validateKYCToken()` - Removed expiration validation
- `KYCLinkResponse` interface - `expiresAt: Date | null`

### 3. WhatsApp Bot (`landlordlookup.ts`)

```typescript
// BEFORE
📅 Expires: Nov 21, 2025

// AFTER
🔄 This link remains active until the property is rented
```

### 4. Frontend Interface (`kyc.service.ts`)

```typescript
export interface KYCLinkResponse {
  token: string;
  link: string;
  expiresAt: string | null; // null means no expiration
  propertyId: string;
}
```

### 5. Tests (`kyc-links.service.spec.ts`)

- Updated all test expectations to use `expiresAt: null`
- Removed expiration-related test cases
- Removed `deactivateExpiredKYCLinks` test suite
- Updated WhatsApp message tests

### 6. Database Migration

Created migration: `make-kyc-links-expires-at-nullable.ts`

- Makes `expires_at` column nullable
- Sets existing active links to `expires_at = NULL`
- Includes rollback logic

## Property Status Integration

The system already had proper integration for deactivating KYC links when property status changes:

**Location:** `tenant-attachment.service.ts`

```typescript
private async deactivateKYCLinks(
  propertyId: string,
  manager: any,
): Promise<void> {
  await manager
    .createQueryBuilder()
    .update(KYCLink)
    .set({ is_active: false })
    .where('property_id = :propertyId', { propertyId })
    .andWhere('is_active = :isActive', { isActive: true })
    .execute();
}
```

This method is called when:

- Tenant is attached to property
- Property status changes to OCCUPIED

## Benefits

### For Landlords

✅ No need to regenerate links every 7 days
✅ Can share link once and forget
✅ Links work as long as property is available
✅ Less maintenance overhead

### For Tenants

✅ No artificial time pressure
✅ Can take time to gather documents
✅ Better application quality
✅ Less frustration with expired links

### For System

✅ Cleaner lifecycle management
✅ No expired link cleanup needed
✅ Logical link deactivation (tied to property status)
✅ Reduced database operations

## Testing Checklist

- [x] All TypeScript files compile without errors
- [x] Unit tests updated and passing
- [x] Database migration created
- [x] Frontend interface updated
- [x] WhatsApp bot message updated
- [ ] Manual testing: Generate KYC link via webapp
- [ ] Manual testing: Generate KYC link via WhatsApp
- [ ] Manual testing: Attach tenant and verify link deactivation
- [ ] Manual testing: Validate link after property becomes occupied

## Migration Instructions

### 1. Run Database Migration

```bash
cd lizt-backend
npm run migration:run
```

### 2. Restart Backend Server

```bash
npm run start:dev
```

### 3. Verify Changes

- Generate a new KYC link
- Check that no expiration date is shown
- Verify link remains active
- Attach tenant and verify link is deactivated

## Rollback Plan

If issues arise, rollback using:

```bash
npm run migration:revert
```

This will:

1. Set default expiration dates for existing links (7 days from now)
2. Make `expires_at` column NOT NULL again

Then revert code changes using git:

```bash
git revert <commit-hash>
```

## Files Modified

### Backend

- `src/kyc-links/entities/kyc-link.entity.ts`
- `src/kyc-links/kyc-links.service.ts`
- `src/whatsapp-bot/templates/landlord/landlordlookup.ts`
- `src/test/kyc-links/kyc-links.service.spec.ts`
- `src/migrations/make-kyc-links-expires-at-nullable.ts` (new)

### Frontend

- `src/services/kyc/kyc.service.ts`

## Notes

- Existing KYC links in database will have their `expires_at` set to NULL
- No data loss - all existing links remain functional
- Property status validation ensures links are only valid for vacant properties
- Manual deactivation still possible through admin interface

## Related Issues

- Fixed: KYC links showing expired dates (Nov 21 instead of current date + 7 days)
- Improved: User experience for both landlords and tenants
- Simplified: System architecture and maintenance

---

**Implementation Date:** November 26, 2025
**Implemented By:** Kiro AI Assistant
**Status:** ✅ Complete - Ready for Testing
