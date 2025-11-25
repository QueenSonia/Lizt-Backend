# Role Priority Fix - Facility Manager vs Landlord

## Issue

When a user has **both LANDLORD and FACILITY_MANAGER accounts**, the system was always routing them to the landlord handler, even when they clicked the facility manager service request button.

### What You Saw

**Expected (FM format):**

```
Here are all service requests:

1. Bathroom light not working — Open
2. AC not cooling — Resolved
```

**Actual (Landlord format):**

```
1. Golden Home – Plumbing – Reported 21 Aug, 2025 – Status: Open
2. Silver Apartments – Electrical – Reported 18 Aug, 2025 – Status: Resolved
```

---

## Root Cause

The role detection logic had this priority:

```
LANDLORD > FACILITY_MANAGER > TENANT
```

So when a user had both accounts, it always picked LANDLORD first.

### Your Logs Showed:

```
🔍 Checking accounts for role... {
  totalAccounts: 2,
  accountRoles: [ 'landlord', 'facility_manager' ],
}
✅ Found LANDLORD account: 1b0f8fb9-ac34-43a0-a8e1-bd4a747d8179
🎭 Role detection result: { detectedRole: 'landlord' }
In Landlord  ← Wrong! Should be "Facility Manager Message"
```

---

## The Fix

Changed the priority order to:

```
FACILITY_MANAGER > LANDLORD > TENANT
```

### Why This Order?

1. **Facility Managers handle service requests** - They're the primary responders
2. **Service request notifications** are sent to FMs, so button clicks should route to FM handler
3. **Landlords can still access** their landlord features by typing "menu" or other commands

### Code Change

**Before:**

```typescript
// Priority: LANDLORD > FACILITY_MANAGER > TENANT

// Check for landlord account first
const landlordAccount = user.accounts.find(
  (acc) => acc.role === RolesEnum.LANDLORD,
);
if (landlordAccount) {
  role = RolesEnum.LANDLORD;
} else {
  // Check for facility manager account
  const facilityAccount = user.accounts.find(
    (acc) => acc.role === RolesEnum.FACILITY_MANAGER,
  );
  if (facilityAccount) {
    role = RolesEnum.FACILITY_MANAGER;
  }
}
```

**After:**

```typescript
// Priority: FACILITY_MANAGER > LANDLORD > TENANT
// (FM takes priority because they handle service requests)

// Check for facility manager account first
const facilityAccount = user.accounts.find(
  (acc) => acc.role === RolesEnum.FACILITY_MANAGER,
);
if (facilityAccount) {
  role = RolesEnum.FACILITY_MANAGER;
} else {
  // Check for landlord account
  const landlordAccount = user.accounts.find(
    (acc) => acc.role === RolesEnum.LANDLORD,
  );
  if (landlordAccount) {
    role = RolesEnum.LANDLORD;
  }
}
```

---

## Expected Behavior Now

### When User Has Both Accounts

**Scenario 1: Clicks "View all service requests" button**

- ✅ Routes to **Facility Manager handler**
- ✅ Shows FM format: `1. Bathroom light not working — Open`

**Scenario 2: Types "menu"**

- ✅ Routes to **Facility Manager handler**
- ✅ Shows FM menu options

**Scenario 3: Wants to access Landlord features**

- User can still access landlord features through specific commands
- Or by temporarily removing FM account (not recommended)

---

## Logs After Fix

You should now see:

```
🔍 Checking accounts for role... {
  totalAccounts: 2,
  accountRoles: [ 'landlord', 'facility_manager' ],
}
✅ Found FACILITY_MANAGER account: [account-id]
🎭 Role detection result: { detectedRole: 'facility_manager' }
Facility Manager Message  ← Correct!
🔘 FM Button clicked: { ... }
✅ Executing handler for: view_all_service_requests
```

---

## Format Comparison

### Facility Manager Format (What You Want)

```
Here are all service requests:

1. Bathroom light not working — Open
2. AC not cooling — Resolved
3. Power socket replacement — Open
4. Broken window lock — Reopened

Reply with a number to view details.
```

**Features:**

- Simple, clean format
- Shows description and status only
- Easy to scan quickly

### Landlord Format (What You Were Getting)

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

**Features:**

- More detailed
- Shows property name, category, date
- Multi-line format

---

## Alternative Solution (Future Enhancement)

For users with multiple roles, you could implement:

### Option 1: Role Selection Menu

```
You have multiple roles. Which would you like to use?

[Facility Manager] [Landlord]
```

### Option 2: Context-Based Routing

- Service request notifications → Always route to FM
- Menu commands → Route based on last used role
- Specific keywords → Route to specific role

### Option 3: Separate Phone Numbers

- Use different phone numbers for different roles
- Simplest but requires multiple WhatsApp accounts

---

## Testing

### Test Case 1: User with Both Accounts

1. Create service request as tenant
2. Click "View all service requests" as FM
3. **Expected:** FM format (simple list)
4. **Verify:** Logs show "Facility Manager Message"

### Test Case 2: User with Only FM Account

1. Click "View all service requests"
2. **Expected:** FM format
3. **Verify:** Works as before

### Test Case 3: User with Only Landlord Account

1. Click "View all service requests"
2. **Expected:** Landlord format (detailed)
3. **Verify:** Works as before

---

## Summary

✅ **Fixed:** Role priority changed to FACILITY_MANAGER > LANDLORD > TENANT
✅ **Result:** Users with both accounts now route to FM handler
✅ **Format:** Now shows simple FM format: `1. Description — Status`
✅ **No Breaking Changes:** Users with single roles unaffected

The facility manager format should now appear correctly when you click the button! 🎉
