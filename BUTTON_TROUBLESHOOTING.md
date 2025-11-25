# Button Not Working - Troubleshooting Guide

## Issue

Clicking "View all service requests" button doesn't give any reply and no errors appear.

---

## Most Likely Causes

### 1. Template Not Created/Approved in Meta ⚠️

**Problem:** The template `fm_service_request_notification` hasn't been created or approved in Meta Business Manager yet.

**Solution:**

1. Go to https://business.facebook.com/wa/manage/message-templates/
2. Check if template `fm_service_request_notification` exists
3. Check if it's **APPROVED** (not pending or rejected)
4. If not created, follow `TEMPLATE_SETUP_GUIDE.md`

**How to verify:**

- If template doesn't exist or isn't approved, WhatsApp won't send the notification at all
- The button won't appear because the message won't be sent

---

### 2. Button Payload Mismatch

**Problem:** The button payload from WhatsApp doesn't match what the code expects.

**Check server logs for:**

```
📱 Incoming WhatsApp message from: 234xxx
📨 Full message object: { ... }
🔘 FM Button clicked: { buttonReply: {...}, buttonId: '...', from: '...' }
```

**Expected button ID:** `view_all_service_requests`

**If you see a different button ID:**

- Update the code to match the actual button ID
- Or update the template to use the correct payload

---

### 3. User Role Not Detected

**Problem:** The system doesn't recognize the user as FM or Landlord.

**Check server logs for:**

```
🎭 Role detection result: {
  detectedRole: 'FACILITY_MANAGER' or 'LANDLORD',
  accountsCount: 1,
  willRouteToDefault: false
}
```

**If `willRouteToDefault: true`:**

- User is not properly set up in database
- Check if user has an account with role FACILITY_MANAGER or LANDLORD
- Check phone number format matches

---

### 4. Message Type Not Recognized

**Problem:** WhatsApp is sending the button click in a different format.

**Check server logs for:**

```
Facility Manager Message
🔘 FM Button clicked: { ... }
```

**If you don't see this:**

- Message might not be type 'interactive'
- Check the full message object structure

---

## Debugging Steps

### Step 1: Check Server Logs

When you click the button, look for these log messages in order:

```
1. 📱 Incoming WhatsApp message from: 234xxx
2. 📨 Full message object: { ... }
3. 🔍 Phone number formats: { ... }
4. 🎭 Role detection result: { ... }
5. Facility Manager Message (or "In Landlord")
6. 🔘 FM Button clicked: { ... } (or Landlord Button clicked)
7. 🔍 Handler lookup: { ... }
8. ✅ Executing handler for: view_all_service_requests
```

**Where it stops tells you the problem:**

- **Stops at step 1-2:** Message not reaching server
- **Stops at step 3-4:** User not found or role not detected
- **Stops at step 5:** Message type not recognized
- **Stops at step 6:** Button reply not in message
- **Stops at step 7:** Button ID doesn't match any handler
- **Reaches step 8:** Handler is executing (check for errors in handler)

---

### Step 2: Verify Template

```bash
# Check if template exists and is approved
curl -X GET "https://graph.facebook.com/v19.0/{WABA_ID}/message_templates?name=fm_service_request_notification" \
  -H "Authorization: Bearer {ACCESS_TOKEN}"
```

**Expected response:**

```json
{
  "data": [
    {
      "name": "fm_service_request_notification",
      "status": "APPROVED",
      "components": [
        {
          "type": "BODY",
          "text": "🛠️ New Service Request\n\nTenant: {{1}}\nProperty: {{2}}\nIssue: {{3}}\nReported: {{4}}"
        },
        {
          "type": "BUTTONS",
          "buttons": [
            {
              "type": "QUICK_REPLY",
              "text": "View all service requests"
            }
          ]
        }
      ]
    }
  ]
}
```

---

### Step 3: Test Button Payload

The button payload might be coming through differently. Check the full message object:

```javascript
// Expected structure
{
  "from": "234xxx",
  "type": "interactive",
  "interactive": {
    "type": "button_reply",
    "button_reply": {
      "id": "view_all_service_requests",  // ← This is what we're checking
      "title": "View all service requests"
    }
  }
}
```

**If `button_reply.id` is different:**

- Note the actual ID
- Update the code to match

---

### Step 4: Check Database

Verify the user has the correct role:

```sql
-- Check user and accounts
SELECT
  u.id,
  u.first_name,
  u.last_name,
  u.phone_number,
  a.role,
  a.id as account_id
FROM users u
LEFT JOIN accounts a ON a.userId = u.id
WHERE u.phone_number IN ('234xxx', '0xxx');
```

**Expected:**

- User exists
- Has at least one account
- Account role is 'FACILITY_MANAGER' or 'LANDLORD'

---

## Quick Fixes

### Fix 1: Template Not Approved

**Wait for Meta approval** (24-48 hours) or check rejection reason.

### Fix 2: Wrong Button ID

If logs show button ID is different (e.g., `button_0`):

```typescript
// In handleFacilityInteractive
case 'view_all_service_requests':
case 'button_0':  // ← Add the actual button ID
case 'service_request': {
```

### Fix 3: User Role Issue

Update user's account role in database:

```sql
UPDATE accounts
SET role = 'FACILITY_MANAGER'
WHERE userId = (SELECT id FROM users WHERE phone_number = '234xxx');
```

### Fix 4: Phone Number Format

Ensure phone number in database matches WhatsApp format:

```sql
-- Update to international format
UPDATE users
SET phone_number = '234xxx'
WHERE phone_number = '0xxx';
```

---

## Testing Checklist

- [ ] Template `fm_service_request_notification` exists in Meta
- [ ] Template status is APPROVED
- [ ] Template has Quick Reply button
- [ ] Button text is "View all service requests"
- [ ] User exists in database
- [ ] User has account with role FACILITY_MANAGER or LANDLORD
- [ ] Phone number format matches
- [ ] Server is running and receiving webhooks
- [ ] Logs show message is received
- [ ] Logs show role is detected
- [ ] Logs show button click is detected
- [ ] Logs show handler is executed

---

## Common Issues

### "No team info available"

**Cause:** Facility manager not properly linked to team

**Fix:**

```sql
-- Check team membership
SELECT * FROM team_members
WHERE accountId = (SELECT id FROM accounts WHERE userId = (SELECT id FROM users WHERE phone_number = '234xxx'));
```

### "No maintenance info available"

**Cause:** Landlord account not found

**Fix:**

```sql
-- Verify landlord account
SELECT * FROM accounts
WHERE userId = (SELECT id FROM users WHERE phone_number = '234xxx')
AND role = 'LANDLORD';
```

### Button appears but nothing happens

**Cause:** Handler is executing but failing silently

**Fix:** Check for errors in the handler execution (database queries, etc.)

---

## Next Steps

1. **Check server logs** when clicking the button
2. **Share the logs** to identify where it's failing
3. **Verify template** is approved in Meta
4. **Check user role** in database

Once you share the logs, I can pinpoint the exact issue!
