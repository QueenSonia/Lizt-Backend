# Service Request Notification Fix

## Problem

When a tenant created a service request via WhatsApp, both facility managers and landlords were receiving the same WhatsApp template notification. This was incorrect because:

- **Landlords** should receive: `landlord_service_request_notification` template
- **Facility Managers** should receive: `fm_service_request_notification` template

## Root Cause

The `sendFacilityServiceRequest` method was trying to differentiate between landlords and facility managers by checking a cache key (`notification_role_${phone_number}`), but this cache was being set **after** the method was called, making it ineffective.

## Solution

### Changes Made

1. **Updated method signature** - Added explicit `is_landlord` parameter to `sendFacilityServiceRequest`:

   ```typescript
   async sendFacilityServiceRequest({
     phone_number,
     manager_name,
     property_name,
     property_location,
     service_request,
     tenant_name,
     tenant_phone_number,
     date_created,
     is_landlord = false, // New parameter
   }: {
     // ... type definitions
     is_landlord?: boolean;
   })
   ```

2. **Updated method calls** - When sending notifications, explicitly specify the recipient type:

   ```typescript
   // For facility managers
   await this.sendFacilityServiceRequest({
     // ... other params
     is_landlord: false, // Explicitly mark as FM notification
   });

   // For landlords
   await this.sendFacilityServiceRequest({
     // ... other params
     is_landlord: true, // Explicitly mark as landlord notification
   });
   ```

3. **Simplified template selection** - Removed cache-based logic and use the parameter directly:
   ```typescript
   if (is_landlord) {
     // Send landlord_service_request_notification template
   } else {
     // Send fm_service_request_notification template
   }
   ```

## Template Differences

### Landlord Template (`landlord_service_request_notification`)

- Contains URL button that redirects to the web dashboard
- Allows landlords to view and manage requests from the web interface

### Facility Manager Template (`fm_service_request_notification`)

- Contains quick reply button "View all service requests"
- Allows FMs to manage requests directly within WhatsApp
- Button triggers `view_all_service_requests` action

## Testing

To verify the fix works:

1. **Test FM notification:**
   - Have a tenant create a service request
   - Facility manager should receive template with "View all service requests" button
   - Clicking button should show list of requests in WhatsApp

2. **Test Landlord notification:**
   - Same service request should notify the landlord
   - Landlord should receive template with URL button to web dashboard
   - Button should redirect to the property management interface

## Files Modified

- `lizt-backend/src/whatsapp-bot/whatsapp-bot.service.ts`
  - Updated `sendFacilityServiceRequest` method signature
  - Updated notification sending logic in `cachedResponse` method
  - Removed cache-based role detection

---

**Date:** November 27, 2025  
**Status:** ✅ Fixed
