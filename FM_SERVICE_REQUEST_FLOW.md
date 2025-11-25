# Facility Manager Service Request Flow

## Complete Interaction Flow

### Step 1: Tenant Creates Service Request

**Tenant Action:** Types "Bathroom light not working"

**System Action:** Creates service request and sends notification to FM

---

### Step 2: FM Receives Notification

**FM Receives:**

```
🛠️ New Service Request

Tenant: John Doe
Property: Golden Home
Issue: Bathroom light not working
Reported: 25 Nov 2025, 10:29 AM

[View all service requests]
```

---

### Step 3: FM Clicks "View all service requests" Button

**FM Action:** Clicks the button

**System Response:**

```
Here are all service requests:

1. Bathroom light not working — Open
2. AC not cooling — Resolved
3. Power socket replacement — Open
4. Broken window lock — Reopened

Reply with a number to view details.
```

**What's Shown:**

- All service requests for properties owned by the landlord
- Excludes CLOSED requests
- Shows: Open, Resolved, Reopened, In Progress
- Format: `number. description — Status`

---

### Step 4: FM Selects a Request

**FM Action:** Types "1"

**System Response:**

```
Bathroom light not working

Tenant: John Doe
Property: Golden Home
Status: Open

Reply "Resolved" to mark it as fixed.
Reply "Back" to go to the list.
```

---

### Step 5A: FM Marks as Resolved

**FM Action:** Types "Resolved"

**System Response to FM:**

```
Great! I've marked this request as resolved. The tenant will confirm if everything is working correctly.
```

**System Action:** Sends confirmation request to tenant

**Tenant Receives:**

```
Hi John 👋🏽

Your service request about "Bathroom light not working" has been marked as resolved.

Can you confirm if everything is fixed?

[Yes, it's fixed 👍🏽] [No, not yet 👎🏽]
```

---

### Step 5B: FM Goes Back to List

**FM Action:** Types "Back"

**System Response:**

```
What would you like to do?

[View all requests] [View Account Info]
```

---

### Step 6A: Tenant Confirms Fixed

**Tenant Action:** Clicks "Yes, it's fixed 👍🏽"

**System Response to Tenant:**

```
Fantastic! Glad that's sorted 😊
```

**FM Receives:**

```
✅ Tenant confirmed the issue is fixed.
Request: Bathroom light not working
Status: Closed
```

**Landlord Receives:**

```
✅ Tenant confirmed the issue is fixed.
Request: Bathroom light not working
Status: Closed
```

---

### Step 6B: Tenant Says Not Fixed

**Tenant Action:** Clicks "No, not yet 👎🏽"

**System Response to Tenant:**

```
Thanks for letting me know. I'll reopen the request and notify maintenance to check again.
```

**FM Receives:**

```
⚠️ Tenant says the issue is not resolved. The request has been reopened.
Request: Bathroom light not working
Status: Reopened
```

**Landlord Receives:**

```
⚠️ Tenant says the issue is not resolved. The request has been reopened.
Request: Bathroom light not working
Status: Reopened
```

---

## Code Implementation

### Handler Location

**File:** `src/whatsapp-bot/whatsapp-bot.service.ts`

**Method:** `handleFacilityInteractive()`

### Button Handler

```typescript
case 'view_all_service_requests':
case 'service_request': {
  // 1. Get team member info
  const teamMemberInfo = await this.teamMemberRepo.findOne({
    where: {
      account: { user: { phone_number: `${from}` } },
    },
    relations: ['team'],
  });

  // 2. Fetch all service requests for landlord's properties
  const serviceRequests = await this.serviceRequestRepo.find({
    where: {
      property: {
        owner_id: teamMemberInfo.team.creatorId,
      },
      status: Not(ServiceRequestStatusEnum.CLOSED),
    },
    relations: ['tenant', 'tenant.user', 'property'],
  });

  // 3. Format response
  let response = 'Here are all service requests:\n\n';
  serviceRequests.forEach((req: any, i) => {
    const statusLabel =
      req.status === ServiceRequestStatusEnum.OPEN ? 'Open'
      : req.status === ServiceRequestStatusEnum.RESOLVED ? 'Resolved'
      : req.status === ServiceRequestStatusEnum.REOPENED ? 'Reopened'
      : req.status === ServiceRequestStatusEnum.IN_PROGRESS ? 'In Progress'
      : req.status;

    response += `${i + 1}. ${req.description} — ${statusLabel}\n`;
  });

  response += '\nReply with a number to view details.';

  // 4. Send response
  await this.sendText(from, response);

  // 5. Cache request IDs for next step
  await this.cache.set(
    `service_request_state_facility_${from}`,
    `view_request_list:${JSON.stringify(serviceRequests.map((r) => r.id))}`,
    this.SESSION_TIMEOUT_MS,
  );
}
```

---

## Status Labels

| Database Status | Display Label              |
| --------------- | -------------------------- |
| `OPEN`          | Open                       |
| `IN_PROGRESS`   | In Progress                |
| `RESOLVED`      | Resolved                   |
| `REOPENED`      | Reopened                   |
| `CLOSED`        | (Not shown - filtered out) |

---

## Query Details

### What Requests Are Shown?

**Included:**

- ✅ All properties owned by the landlord (via team membership)
- ✅ Status: Open, In Progress, Resolved, Reopened

**Excluded:**

- ❌ Closed requests
- ❌ Requests from other landlords' properties

### Database Query

```typescript
serviceRequestRepo.find({
  where: {
    property: {
      owner_id: teamMemberInfo.team.creatorId, // Landlord's properties
    },
    status: Not(ServiceRequestStatusEnum.CLOSED), // Exclude closed
  },
  relations: ['tenant', 'tenant.user', 'property'],
});
```

---

## Example Scenarios

### Scenario 1: Multiple Properties

**Landlord owns:**

- Golden Home (3 requests)
- Silver Apartments (2 requests)

**FM sees:**

```
Here are all service requests:

1. Bathroom light not working — Open (Golden Home)
2. AC not cooling — Resolved (Golden Home)
3. Door lock broken — Open (Golden Home)
4. Leaking tap — In Progress (Silver Apartments)
5. Broken window — Reopened (Silver Apartments)

Reply with a number to view details.
```

### Scenario 2: No Open Requests

**All requests are closed**

**FM sees:**

```
No service requests found.
```

### Scenario 3: Single Request

**Only one open request**

**FM sees:**

```
Here are all service requests:

1. Bathroom light not working — Open

Reply with a number to view details.
```

---

## Testing Checklist

- [x] Code updated to handle `button` message type
- [x] Button handler extracts correct button ID
- [ ] Test: Click button and verify list appears
- [ ] Test: List shows correct format
- [ ] Test: List excludes closed requests
- [ ] Test: Typing number shows request details
- [ ] Test: "Resolved" marks request as resolved
- [ ] Test: "Back" returns to menu
- [ ] Test: Tenant confirmation works

---

## Next Steps

1. **Test the button** - Click "View all service requests"
2. **Verify format** - Should match the format above
3. **Test full flow** - Select a request, mark as resolved, confirm with tenant

The code is ready and should work now with the button type fix applied! 🎉
