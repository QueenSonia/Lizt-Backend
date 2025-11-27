# KYC Link Expiration Removal - Implementation Summary

## Overview

Removed time-based expiration from KYC links. Links now remain active until property status changes, providing a better user experience for both landlords and tenants.

## Problem Statement

- **Original Issue**: KYC links were showing expired dates (Nov 21, 2025) when generated on Nov 26, 2025
- **Root Cause**: System was returning existing links with old expiration dates instead of creating new ones
- **Deeper Issue**: 7-day expiration was too restrictive and didn't align with real-world property rental timelines

## Solution Implemented

**Option B: Remove expiration, rely on property status**

KYC links now remain active until:

1. Property becomes occupied (tenant attached)
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

- ❌ `DEFAULT_EXPIRY_DAYS` constant
- ❌ Expiration date calculation logic
- ❌ Expiration date extension logic
- ❌ Expired link cleanup methods
- ❌ Expiration validation checks

#### Updated:

- ✅ `generateKYCLink()` - Returns `expiresAt: null`
- ✅ `validateKYCToken()` - Removed expiration checks
- ✅ `KYCLinkResponse` interface - Made `expiresAt` nullable

#### Key Changes:

```typescript
// Link generation now returns null expiration
return {
  token,
  link,
  expiresAt: null, // No expiration
  propertyId,
};

// Validation no longer checks expiration
// Only checks: is_active, property exists, property is vacant
```

### 3. WhatsApp Bot (`landlordlookup.ts`)

#### BEFORE:

```
✅ KYC link for *Property Name*
🔗 https://lizt.co/kyc/token
📅 Expires: Nov 21, 2025
```

#### AFTER:

```
✅ KYC link for *Property Name*
🔗 https://lizt.co/kyc/token
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

### 5. Database Migration

Created migration: `make-kyc-links-expires-at-nullable.ts`

- Makes `expires_at` column nullable
- Sets existing active links to `NULL` expiration
- Includes rollback logic

## Link Lifecycle Management

### Active Link Deactivation

Links are automatically deactivated when:

1. **Property Becomes Occupied**
   - Location: `TenantAttachmentService.attachTenantToProperty()`
   - Trigger: When landlord attaches tenant from KYC application
   - Method: `deactivateKYCLinks(propertyId)`

2. **Property Status Changes**
   - Validation happens in `validateKYCToken()`
   - If property is no longer vacant → link is deactivated

3. **Property Deleted**
   - Cascade deletion through foreign key relationship

### Manual Deactivation

Landlords can manually deactivate links through:

- Property management interface
- Direct database update (admin)

## Benefits

### For Landlords

- ✅ No need to regenerate links every 7 days
- ✅ Share link once, works until property is rented
- ✅ Less friction in tenant acquisition process
- ✅ Consistent link for all applicants

### For Tenants

- ✅ No artificial time pressure to complete application
- ✅ Can take time to gather required documents
- ✅ Better application quality
- ✅ No "link expired" frustration

### For System

- ✅ Cleaner link lifecycle management
- ✅ No expired link cleanup needed
- ✅ Logical deactivation tied to actual events
- ✅ Reduced database operations
- ✅ Better alignment with business logic

## Testing Checklist

### Backend Tests

- [ ] Generate KYC link for vacant property → Returns link with `expiresAt: null`
- [ ] Generate KYC link twice → Returns same link (no expiration extension)
- [ ] Validate active KYC link → Returns valid (no expiration check)
- [ ] Attach tenant to property → KYC links deactivated
- [ ] Validate KYC link for occupied property → Returns invalid
- [ ] Property deleted → KYC links cascade deleted

### WhatsApp Bot Tests

- [ ] Landlord generates KYC link → Receives message without expiration date
- [ ] Message shows "remains active until property is rented"
- [ ] Link works immediately after generation
- [ ] Link stops working after property becomes occupied

### Frontend Tests

- [ ] Generate KYC link modal → Shows link without expiration date
- [ ] Copy link functionality works
- [ ] Link remains valid for extended period
- [ ] Appropriate error message when link is deactivated

## Migration Instructions

### 1. Run Database Migration

```bash
cd lizt-backend
npm run migration:run
```

### 2. Verify Migration

```sql
-- Check that expires_at is nullable
SELECT column_name, is_nullable
FROM information_schema.columns
WHERE table_name = 'kyc_links' AND column_name = 'expires_at';

-- Check existing active links have NULL expiration
SELECT id, token, expires_at, is_active
FROM kyc_links
WHERE is_active = true;
```

### 3. Deploy Backend

```bash
npm run build
npm run start:prod
```

### 4. Deploy Frontend

```bash
cd lizt-frontend
npm run build
# Deploy to production
```

## Rollback Plan

If issues arise, rollback using:

```bash
# Rollback database migration
npm run migration:revert

# Revert code changes
git revert <commit-hash>
```

## Monitoring

### Key Metrics to Watch

1. **KYC Link Generation Rate**: Should remain stable
2. **Link Validation Success Rate**: Should increase (no expiration failures)
3. **Application Completion Rate**: Should increase (more time to complete)
4. **Active Links Count**: May increase (links stay active longer)

### Alerts to Set Up

- Monitor for unusually high number of active links per property
- Alert if property status changes don't deactivate links
- Track application submission rates

## Related Files

### Backend

- `src/kyc-links/entities/kyc-link.entity.ts`
- `src/kyc-links/kyc-links.service.ts`
- `src/kyc-links/tenant-attachment.service.ts`
- `src/whatsapp-bot/templates/landlord/landlordlookup.ts`
- `src/migrations/make-kyc-links-expires-at-nullable.ts`

### Frontend

- `src/services/kyc/kyc.service.ts`
- `src/components/GenerateKYCLinkModal.tsx`

## Future Considerations

### Potential Enhancements

1. **Link Analytics**: Track how long links remain active before tenant attachment
2. **Link Sharing Metrics**: Monitor how many times a link is accessed
3. **Application Funnel**: Track conversion from link click to application submission
4. **Landlord Dashboard**: Show active links and their application counts

### Possible Issues to Monitor

1. **Stale Links**: Properties that remain vacant for very long periods
2. **Link Abuse**: Same link shared too widely
3. **Data Accumulation**: Large number of inactive links over time

## Documentation Updates Needed

- [ ] Update API documentation
- [ ] Update user guides for landlords
- [ ] Update WhatsApp bot documentation
- [ ] Update system architecture diagrams

## Conclusion

This change simplifies the KYC link system by removing arbitrary time-based expiration and relying on actual property status changes. This provides a better user experience while maintaining proper access control and data integrity.

**Status**: ✅ Implementation Complete
**Date**: November 26, 2025
**Version**: 2.0.0
