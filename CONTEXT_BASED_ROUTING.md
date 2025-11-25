# Context-Based Role Routing - Proper Solution

## The Right Approach

Instead of using a fixed priority order, the system now **checks which role the notification was sent to** and routes accordingly.

---

## How It Works

### Step 1: Store Context When Sending Notification

When a service request is created, the system sends notifications to:

1. **Facility Managers** - Stored with context `FACILITY_MANAGER`
2. **Landlord (Property Owner)** - Stored with context `LANDLORD`

```typescript
// When sending to facility manager
await this.sendFacilityServiceRequest({ phone_number: manager.phone_number, ... });
await this.cache.set(
  `notification_role_${manager.phone_number}`,
  'FACILITY_MANAGER',
  24 * 60 * 60 * 1000, // 24 hours
);

// When sending to landlord
await this.sendFacilityServiceRequest({ phone_number: admin_phone_number, ... });
await this.cache.set(
  `notification_role_${admin_phone_number}`,
  'LANDLORD',
  24 * 60 * 60 * 1000, // 24 hours
);
```

### Step 2: Check Context When Message Arrives

When a user clicks the button or sends a message:

```typescript
// 1. Check if there's a notification context
const notificationRole = await this.cache.get(`notification_role_${from}`);

// 2. If context exists, use that role
if (notificationRole) {
  console.log('📬 Found notification context:', notificationRole);
  role = notificationRole; // Use the role from notification
}

// 3. If no context, use priority order (FM > Landlord > Tenant)
if (!notificationRole) {
  console.log('📝 No notification context, using priority order');
  // Check for FM first, then Landlord, then Tenant
}
```

---

## Benefits

### ✅ Correct Routing

- FM receives notification → Clicks button → Routes to FM handler → Sees FM format
- Landlord receives notification → Clicks button → Routes to Landlord handler → Sees Landlord format

### ✅ Handles Multiple Roles

- User with both FM and Landlord accounts gets correct format based on which notification they clicked

### ✅ Context-Aware

- System remembers which role the notification was sent to
- Routes based on actual context, not arbitrary priority

### ✅ Fallback Priority

- If no notification context (e.g., user types "menu"), uses priority: FM > Landlord > Tenant

---

## Example Scenarios

### Scenario 1: User with Both FM and Landlord Accounts

**Case A: Receives notification as FM**

```
1. Tenant creates service request
2. System sends notification to FM phone number
3. Cache stores: notification_role_2348186744284 = "FACILITY_MANAGER"
4. FM clicks "View all service requests"
5. System checks cache → Found "FACILITY_MANAGER"
6. Routes to FM handler
7. Shows FM format: "1. Bathroom light not working — Open"
```

**Case B: Receives notification as Landlord**

```
1. Tenant creates service request
2. System sends notification to Landlord phone number
3. Cache stores: notification_role_2348186744284 = "LANDLORD"
4. Landlord clicks "View all service requests"
5. System checks cache → Found "LANDLORD"
6. Routes to Landlord handler
7. Shows Landlord format: "1. Golden Home – Plumbing – Reported..."
```

### Scenario 2: User Types "menu" (No Notification Context)

```
1. User types "menu"
2. System checks cache → No notification context
3. Uses priority order: FM > Landlord > Tenant
4. User has FM account → Routes to FM handler
5. Shows FM menu
```

---

## Code Flow

### Sending Notification

```typescript
// In createServiceRequest handler

// Send to facility managers
for (const manager of facility_managers) {
  await this.sendFacilityServiceRequest({ phone_number: manager.phone_number, ... });

  // ✅ Store context
  await this.cache.set(
    `notification_role_${manager.phone_number}`,
    'FACILITY_MANAGER',
    24 * 60 * 60 * 1000,
  );
}

// Send to landlord
await this.sendFacilityServiceRequest({ phone_number: admin_phone_number, ... });

// ✅ Store context
await this.cache.set(
  `notification_role_${admin_phone_number}`,
  'LANDLORD',
  24 * 60 * 60 * 1000,
);
```

### Receiving Message

```typescript
// In handleMessage

// ✅ Check notification context first
const notificationRole = await this.cache.get(`notification_role_${from}`);

if (notificationRole) {
  // Use the role from notification
  role = notificationRole;
} else {
  // Use priority order: FM > Landlord > Tenant
  if (facilityAccount) role = 'FACILITY_MANAGER';
  else if (landlordAccount) role = 'LANDLORD';
  else if (tenantAccount) role = 'TENANT';
}

// Route based on role
switch (role) {
  case 'FACILITY_MANAGER': // FM handler
  case 'LANDLORD': // Landlord handler
  case 'TENANT': // Tenant handler
}
```

---

## Cache Details

### Key Format

```
notification_role_{phone_number}
```

### Value

```
"FACILITY_MANAGER" | "LANDLORD" | "TENANT"
```

### TTL (Time To Live)

```
24 hours (86400000 ms)
```

### Why 24 Hours?

- WhatsApp conversation window is 24 hours
- After 24 hours, context is no longer relevant
- User would need a new notification to continue

---

## Logs

### When Notification is Sent

```
✅ Sending notification to FM: 2348186744284
💾 Stored notification context: FACILITY_MANAGER
```

### When Button is Clicked

```
📱 Incoming WhatsApp message from: 2348186744284
🔍 Checking accounts for role...
📬 Found notification context: FACILITY_MANAGER
✅ Using notification context role: FACILITY_MANAGER
🎭 Role detection result: { detectedRole: 'facility_manager' }
Facility Manager Message
```

### When No Context (User Types "menu")

```
📱 Incoming WhatsApp message from: 2348186744284
🔍 Checking accounts for role...
📝 No notification context, using priority order
✅ Found FACILITY_MANAGER account: [id]
🎭 Role detection result: { detectedRole: 'facility_manager' }
Facility Manager Message
```

---

## Format Comparison

### Facility Manager Format

```
Here are all service requests:

1. Bathroom light not working — Open
2. AC not cooling — Resolved
3. Power socket replacement — Open

Reply with a number to view details.
```

### Landlord Format

```
Here are open maintenance requests:

1. Golden Home
Plumbing
Reported 21 Aug, 2025
Status: Open

2. Silver Apartments
Electrical
Reported 18 Aug, 2025
Status: Resolved

Reply with the number of the request you want to view.
```

---

## Testing

### Test Case 1: FM Receives Notification

1. Create service request as tenant
2. FM receives notification
3. FM clicks "View all service requests"
4. **Expected:** FM format (simple list)
5. **Verify:** Logs show "Found notification context: FACILITY_MANAGER"

### Test Case 2: Landlord Receives Notification

1. Create service request as tenant
2. Landlord receives notification
3. Landlord clicks "View all service requests"
4. **Expected:** Landlord format (detailed)
5. **Verify:** Logs show "Found notification context: LANDLORD"

### Test Case 3: User with Both Roles, No Context

1. User types "menu"
2. **Expected:** FM format (priority order)
3. **Verify:** Logs show "No notification context, using priority order"

### Test Case 4: Context Expires After 24 Hours

1. Receive notification
2. Wait 24+ hours
3. Click button
4. **Expected:** Uses priority order (FM format)
5. **Verify:** Logs show "No notification context"

---

## Summary

✅ **Context-Based:** Routes based on which role received the notification
✅ **Accurate:** FM sees FM format, Landlord sees Landlord format
✅ **Handles Multiple Roles:** Works correctly for users with multiple accounts
✅ **Fallback Priority:** Uses FM > Landlord > Tenant when no context
✅ **Time-Limited:** Context expires after 24 hours (WhatsApp window)

This is the **proper solution** that respects the actual context of the interaction! 🎉
