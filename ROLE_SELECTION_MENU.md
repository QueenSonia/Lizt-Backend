# Role Selection Menu - Implementation Complete ✅

## Overview

Users with multiple roles (e.g., both FACILITY_MANAGER and LANDLORD) now see a role selection menu when they first interact with the WhatsApp bot.

---

## How It Works

### Step 1: User Sends Message

When a user with multiple roles sends any message (or clicks a button):

```
User: "menu" (or clicks button from notification)
```

### Step 2: System Detects Multiple Roles

```
🔍 Checking accounts for role...
👥 User has multiple roles, showing role selection menu
```

### Step 3: Role Selection Menu Appears

```
You have multiple roles. Which would you like to use?

[Facility Manager] [Landlord]
```

### Step 4: User Selects Role

**Option A: User clicks "Facility Manager"**

```
✅ User selected role: FACILITY_MANAGER
💾 Stored in cache for 24 hours

Hello Manager John Welcome to Property Kraft! What would you like to do today?

[View all service requests] [View Account Info] [Visit our website]
```

**Option B: User clicks "Landlord"**

```
✅ User selected role: LANDLORD
💾 Stored in cache for 24 hours

Hello John, What do you want to do today?

[View properties] [maintenance requests] [Add new tenant]
```

### Step 5: Role Persists for 24 Hours

Once selected, the role is remembered for 24 hours. All subsequent interactions use that role.

---

## Switching Roles

### Method 1: Type "switch" or "switch role"

```
User: "switch"
↓
System: "Role cleared. Send any message to select a new role."
↓
User: "menu"
↓
System: Shows role selection menu again
```

### Method 2: Wait 24 Hours

After 24 hours, the cached role expires and the menu appears again automatically.

---

## Complete User Flows

### Flow 1: FM Receives Service Request Notification

```
1. Tenant creates service request
2. FM receives notification with button
3. FM clicks "View all service requests"
4. System shows: "You have multiple roles. Which would you like to use?"
5. FM clicks "Facility Manager"
6. System shows: "Here are all service requests: 1. Bathroom light..."
7. FM can now manage service requests
```

### Flow 2: Landlord Wants to Add Tenant

```
1. Landlord types "menu"
2. System shows: "You have multiple roles. Which would you like to use?"
3. Landlord clicks "Landlord"
4. System shows landlord menu
5. Landlord clicks "Add new tenant"
6. System starts tenant onboarding flow
```

### Flow 3: Switching from FM to Landlord

```
1. User is currently in FM mode
2. User types "switch"
3. System: "Role cleared. Send any message to select a new role."
4. User types "menu"
5. System shows role selection menu
6. User clicks "Landlord"
7. Now in Landlord mode
```

---

## Features by Role

### Facility Manager Features

- ✅ View all service requests (simple format)
- ✅ Mark requests as resolved
- ✅ View request details
- ✅ View account info
- ✅ Respond to service request notifications

### Landlord Features

- ✅ View properties (vacant/occupied)
- ✅ View maintenance requests (detailed format)
- ✅ Add new tenant
- ✅ View tenancy details
- ✅ View rent information

---

## Technical Implementation

### Role Detection Logic

```typescript
// 1. Check if user has selected a role
const selectedRole = await this.cache.get(`selected_role_${from}`);

if (selectedRole) {
  // Use the selected role
  role = selectedRole;
} else {
  // Check if user has multiple roles
  const hasMultipleRoles = user.accounts.length > 1;
  const hasFM = user.accounts.some((acc) => acc.role === 'FACILITY_MANAGER');
  const hasLandlord = user.accounts.some((acc) => acc.role === 'LANDLORD');

  if (hasMultipleRoles && (hasFM || hasLandlord)) {
    // Show role selection menu
    await this.sendButtons(from, 'You have multiple roles...', roleButtons);
    return; // Don't route yet
  }

  // Single role - use priority order
  // FM > Landlord > Tenant
}
```

### Role Selection Handler

```typescript
// In handleInteractive
if (buttonId === 'select_role_fm' || buttonId === 'select_role_landlord') {
  const selectedRole =
    buttonId === 'select_role_fm' ? 'FACILITY_MANAGER' : 'LANDLORD';

  // Store in cache for 24 hours
  await this.cache.set(
    `selected_role_${from}`,
    selectedRole,
    24 * 60 * 60 * 1000,
  );

  // Show appropriate menu
  if (selectedRole === 'FACILITY_MANAGER') {
    // Show FM menu
  } else {
    // Show Landlord menu
  }
}
```

### Switch Role Handler

```typescript
// In handleText, handleFacilityText, and landlordflow.handleText
if (text?.toLowerCase() === 'switch role' || text?.toLowerCase() === 'switch') {
  await this.cache.delete(`selected_role_${from}`);
  await this.sendText(
    from,
    'Role cleared. Send any message to select a new role.',
  );
  return;
}
```

---

## Cache Details

### Key Format

```
selected_role_{phone_number}
```

### Value

```
"FACILITY_MANAGER" | "LANDLORD"
```

### TTL (Time To Live)

```
24 hours (86400000 ms)
```

---

## Format Differences

### Facility Manager Format

```
Here are all service requests:

1. Bathroom light not working — Open
2. AC not cooling — Resolved
3. Power socket replacement — Open

Reply with a number to view details.
```

**Characteristics:**

- Simple, clean list
- Description + Status only
- Easy to scan quickly
- Focused on action

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

**Characteristics:**

- Detailed information
- Property name, category, date
- Multi-line format
- More context

---

## Commands Reference

| Command                   | Action                                               |
| ------------------------- | ---------------------------------------------------- |
| `menu`                    | Show main menu (or role selection if multiple roles) |
| `switch` or `switch role` | Clear selected role and show selection menu          |
| `done`                    | End session and clear cache                          |

---

## Testing Checklist

### Test Case 1: User with Both Roles

- [ ] Send message as user with FM + Landlord accounts
- [ ] Verify role selection menu appears
- [ ] Click "Facility Manager"
- [ ] Verify FM menu appears
- [ ] Verify service requests show FM format

### Test Case 2: Switch Roles

- [ ] Select FM role
- [ ] Type "switch"
- [ ] Verify role cleared message
- [ ] Type "menu"
- [ ] Verify role selection menu appears again
- [ ] Click "Landlord"
- [ ] Verify landlord menu appears

### Test Case 3: Role Persistence

- [ ] Select FM role
- [ ] Type "menu" again
- [ ] Verify FM menu appears (no role selection)
- [ ] Verify role persists across interactions

### Test Case 4: Service Request Notification

- [ ] Create service request as tenant
- [ ] Click button as user with both roles
- [ ] Verify role selection menu appears
- [ ] Select FM
- [ ] Verify FM format appears

### Test Case 5: Single Role User

- [ ] Send message as user with only FM account
- [ ] Verify NO role selection menu
- [ ] Verify FM menu appears directly

---

## Logs

### When Role Selection Menu is Shown

```
🔍 Checking accounts for role...
👥 User has multiple roles, showing role selection menu
```

### When Role is Selected

```
✅ User selected role: FACILITY_MANAGER
💾 Stored selected_role_2348186744284 = FACILITY_MANAGER (24h)
```

### When Role is Used

```
🔍 Checking accounts for role...
✅ Using previously selected role: FACILITY_MANAGER
🎭 Role detection result: { detectedRole: 'facility_manager' }
Facility Manager Message
```

### When Role is Switched

```
🗑️ Deleted selected_role_2348186744284
Role cleared. Send any message to select a new role.
```

---

## Benefits

✅ **Access to All Features:** Users can access both FM and Landlord features

✅ **User Control:** Users choose which role to use

✅ **Persistent:** Role selection lasts 24 hours (no need to select every time)

✅ **Switchable:** Easy to switch roles with "switch" command

✅ **Clean UX:** Clear menu, simple selection process

✅ **No Breaking Changes:** Single-role users unaffected

---

## Summary

The role selection menu allows users with multiple roles to:

1. Choose which role to use (FM or Landlord)
2. Access all features for that role
3. Switch roles anytime with "switch" command
4. Have their selection remembered for 24 hours

This provides the best of both worlds - access to all features while maintaining clean, role-specific interfaces! 🎉
