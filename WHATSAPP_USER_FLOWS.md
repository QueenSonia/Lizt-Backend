# WhatsApp User Flows - Visual Guide

Complete visual guide showing exactly what users see at each step of the service request flow.

---

## 🏠 TENANT FLOW

### Step 1: Tenant Opens WhatsApp

**Tenant types:** `menu`

**System responds with buttons:**

```
Hello John What would you like to do?

┌─────────────────────────────────┐
│ Make service request            │
└─────────────────────────────────┘
┌─────────────────────────────────┐
│ View tenancy details            │
└─────────────────────────────────┘
┌─────────────────────────────────┐
│ Visit our website               │
└─────────────────────────────────┘
```

---

### Step 2: Tenant Clicks "Make service request"

**Button ID:** `service_request`

**System responds with buttons:**

```
What would you like to do?

┌─────────────────────────────────┐
│ Request a service               │
└─────────────────────────────────┘
┌─────────────────────────────────┐
│ View previous requests          │
└─────────────────────────────────┘
```

---

### Step 3A: Tenant Clicks "Request a service" (Single Property)

**Button ID:** `new_service_request`

**If tenant has only ONE property:**

**System responds:**

```
Sure! Please tell me what needs to be fixed.
```

**Tenant types:** `The bathroom light isn't working.`

**System responds with buttons:**

```
Got it. I've noted your request — someone will take a look and reach out once it's being handled.

Want to do something else?

┌─────────────────────────────────┐
│ Request a service               │
└─────────────────────────────────┘
┌─────────────────────────────────┐
│ Go back to main menu            │
└─────────────────────────────────┘
```

---

### Step 3B: Tenant Clicks "Request a service" (Multiple Properties)

**Button ID:** `new_service_request`

**If tenant has MULTIPLE properties:**

**System responds:**

```
Which property is this request for?

1. Golden Home
2. Silver Apartments

Reply with the number of the property.
```

**Tenant types:** `1`

**System responds:**

```
Sure! Please tell me what needs to be fixed.
```

**Tenant types:** `The bathroom light isn't working.`

**System responds with buttons:**

```
Got it. I've noted your request — someone will take a look and reach out once it's being handled.

Want to do something else?

┌─────────────────────────────────┐
│ Request a service               │
└─────────────────────────────────┘
┌─────────────────────────────────┐
│ Go back to main menu            │
└─────────────────────────────────┘
```

---

### Step 4: Tenant Clicks "View previous requests"

**Button ID:** `view_service_request`

**If tenant has requests:**

**System responds with buttons:**

```
Here are your recent service requests:
• 14 Aug 2025, 10:32am – Bathroom light not working (Open)
• 10 Aug 2025, 3:18pm – AC not cooling (Resolved)
• 02 Aug 2025, 5:40pm – Power socket replacement (Closed)

Want to do something else?

┌─────────────────────────────────┐
│ Request a service               │
└─────────────────────────────────┘
┌─────────────────────────────────┐
│ Go back to main menu            │
└─────────────────────────────────┘
```

**If tenant has NO requests:**

**System responds:**

```
You don't have any service requests yet.
```

---

### Step 5: Tenant Receives Confirmation Request

**When FM marks request as resolved, tenant receives template:**

```
Hi John 👋🏽

Your service request about "Bathroom light not working" has been marked as resolved.

Can you confirm if everything is fixed?

┌─────────────────────────────────┐
│ Yes, it's fixed 👍🏽             │
└─────────────────────────────────┘
┌─────────────────────────────────┐
│ No, not yet 👎🏽                 │
└─────────────────────────────────┘
```

---

### Step 6A: Tenant Clicks "Yes, it's fixed 👍🏽"

**Button ID:** `confirm_resolution_yes`

**System responds:**

```
Fantastic! Glad that's sorted 😊
```

**Behind the scenes:**

- Request status → CLOSED
- FM receives: "✅ Tenant confirmed the issue is fixed."
- Landlord receives: "✅ Tenant confirmed the issue is fixed."

---

### Step 6B: Tenant Clicks "No, not yet 👎🏽"

**Button ID:** `confirm_resolution_no`

**System responds:**

```
Thanks for letting me know. I'll reopen the request and notify maintenance to check again.
```

**Behind the scenes:**

- Request status → REOPENED
- FM receives: "⚠️ Tenant says the issue is not resolved. The request has been reopened."
- Landlord receives: "⚠️ Tenant says the issue is not resolved. The request has been reopened."

---

## 🔧 FACILITY MANAGER FLOW

### Step 1: FM Receives New Request Notification

**When tenant creates a request, FM receives template:**

```
🛠️ New Service Request

Tenant: John Doe
Property: Golden Home
Issue: Bathroom light not working
Reported: 21 Aug 2025, 09:42 AM

Reply Options to see what you can do.
```

---

### Step 2: FM Types "Options"

**FM types:** `Options` (or `options` or `menu`)

**System responds with buttons:**

```
Hello Manager Sarah Welcome to Property Kraft! What would you like to do today?

┌─────────────────────────────────┐
│ View all service requests       │
└─────────────────────────────────┘
┌─────────────────────────────────┐
│ View Account Info               │
└─────────────────────────────────┘
┌─────────────────────────────────┐
│ Visit our website               │
└─────────────────────────────────┘
```

**Note:** Currently "Options" triggers the default menu. The template says "Reply Options" but typing it shows the main menu.

---

### Step 3: FM Clicks "View all service requests"

**Button ID:** `service_request`

**If there are requests:**

**System responds:**

```
Here are all service requests:

1. Bathroom light not working — Open
2. AC not cooling — Resolved
3. Power socket replacement — Open
4. Broken window lock — Reopened

Reply with a number to view details.
```

**If there are NO requests:**

**System responds:**

```
No service requests found.
```

---

### Step 4: FM Types a Number

**FM types:** `1`

**System responds:**

```
Bathroom light not working

Tenant: John Doe
Property: Golden Home
Status: Open

Reply "Resolved" to mark it as fixed.
Reply "Back" to go to the list.
```

---

### Step 5A: FM Types "Resolved"

**FM types:** `Resolved`

**System responds:**

```
Great! I've marked this request as resolved. The tenant will confirm if everything is working correctly.
```

**Behind the scenes:**

- Request status → RESOLVED
- Tenant receives confirmation template (with Yes/No buttons)
- Landlord notified

---

### Step 5B: FM Types "Back"

**FM types:** `Back`

**System responds with buttons:**

```
What would you like to do?

┌─────────────────────────────────┐
│ View all requests               │
└─────────────────────────────────┘
┌─────────────────────────────────┐
│ View Account Info               │
└─────────────────────────────────┘
```

---

### Step 6: FM Receives Tenant Confirmation

**When tenant confirms "Yes":**

**System sends to FM:**

```
✅ Tenant confirmed the issue is fixed.
Request: Bathroom light not working
Status: Closed
```

**When tenant confirms "No":**

**System sends to FM:**

```
⚠️ Tenant says the issue is not resolved. The request has been reopened.
Request: Bathroom light not working
Status: Reopened
```

---

## 🏢 LANDLORD FLOW

### Landlord Receives New Request

**When tenant creates a request, landlord receives same template as FM:**

```
🛠️ New Service Request

Tenant: John Doe
Property: Golden Home
Issue: Bathroom light not working
Reported: 21 Aug 2025, 09:42 AM

Reply Options to see what you can do.
```

**Landlord can interact the same way as FM** (view requests, resolve, etc.)

---

### Landlord Receives Tenant Confirmation

**When tenant confirms "Yes":**

```
✅ Tenant confirmed the issue is fixed.
Request: Bathroom light not working
Status: Closed
```

**When tenant confirms "No":**

```
⚠️ Tenant says the issue is not resolved. The request has been reopened.
Request: Bathroom light not working
Status: Reopened
```

---

## 📊 COMPLETE FLOW DIAGRAM

```
TENANT CREATES REQUEST
         ↓
    [New Request]
         ↓
    ┌────┴────┐
    ↓         ↓
   FM      LANDLORD
    ↓         ↓
[Receives Notification]
    ↓
[Types "Options"]
    ↓
[Views All Requests]
    ↓
[Selects Request #]
    ↓
[Types "Resolved"]
    ↓
[Status: RESOLVED]
    ↓
TENANT RECEIVES CONFIRMATION
    ↓
┌───┴───┐
↓       ↓
YES     NO
↓       ↓
CLOSED  REOPENED
↓       ↓
FM/LL   FM/LL
Notified Notified
```

---

## 🎯 KEY COMMANDS

### Tenant Commands

- `menu` - Show main menu
- `done` - End session
- `[number]` - Select property (multi-property tenants)
- `[text]` - Describe issue

### Facility Manager Commands

- `Options` or `menu` - Show main menu
- `[number]` - Select request to view
- `Resolved` - Mark request as resolved
- `Back` - Return to request list
- `done` - End session

### Universal Commands

- `menu` - Show main menu
- `done` - End session

---

## 🔄 STATUS FLOW

```
PENDING → IN_PROGRESS → RESOLVED → CLOSED
                             ↓
                         REOPENED → RESOLVED → CLOSED
```

**Status Meanings:**

- **PENDING** - New request, not yet viewed
- **OPEN** - Request acknowledged
- **IN_PROGRESS** - FM is working on it
- **RESOLVED** - FM marked as fixed, awaiting tenant confirmation
- **CLOSED** - Tenant confirmed issue is fixed
- **REOPENED** - Tenant said issue not fixed after resolution

---

## 💡 IMPORTANT NOTES

### For Tenants:

- You can create requests anytime by typing `menu`
- If you have multiple properties, you'll be asked to select which one
- You'll receive a confirmation request when FM marks issue as resolved
- You can view all your past requests anytime

### For Facility Managers:

- You receive notifications for ALL new requests
- Type "Options" or "menu" after receiving a notification
- You can view all open requests at once
- Mark requests as "Resolved" to trigger tenant confirmation
- You'll be notified when tenant confirms or rejects the resolution

### For Landlords:

- You receive the same notifications as facility managers
- You can interact with requests the same way as FMs
- You see all requests across all your properties

---

## 🐛 TROUBLESHOOTING

**Issue**: Tenant types text but nothing happens

- **Solution**: They may be in a state waiting for specific input. Type `done` to reset, then `menu` to start over.

**Issue**: FM types "Options" but gets wrong menu

- **Solution**: Currently "Options" shows the main menu. This is correct - from there, click "View all service requests"

**Issue**: Buttons not showing

- **Solution**: Make sure you're using WhatsApp (not SMS). Buttons only work in WhatsApp.

**Issue**: Can't select property

- **Solution**: Type the number only (e.g., `1` not `1.` or `Property 1`)

**Issue**: Request not showing in list

- **Solution**: Only non-closed requests show in FM list. Closed requests are hidden.

---

**Last Updated**: November 25, 2025
**Version**: 1.0
