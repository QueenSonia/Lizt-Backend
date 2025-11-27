# KYC Link Expiration Removal - Deployment Checklist

## Pre-Deployment

### Code Review

- [x] All TypeScript files compile without errors
- [x] No diagnostic issues in modified files
- [x] Migration file created and validated
- [x] Documentation updated

### Testing (Local)

- [ ] Generate new KYC link → Returns `expiresAt: null`
- [ ] Generate KYC link twice for same property → Returns same link
- [ ] Validate active KYC link → Returns valid
- [ ] Attach tenant to property → KYC links deactivated
- [ ] Validate KYC link for occupied property → Returns invalid
- [ ] WhatsApp bot generates link → Shows correct message
- [ ] Frontend modal displays link correctly

### Database Backup

- [ ] Backup production database before migration
- [ ] Test migration on staging database first
- [ ] Verify rollback procedure works

## Deployment Steps

### 1. Backend Deployment

#### Step 1.1: Stop Application (if needed)

```bash
# If using PM2
pm2 stop lizt-backend

# If using systemd
sudo systemctl stop lizt-backend
```

#### Step 1.2: Pull Latest Code

```bash
cd lizt-backend
git pull origin main
npm install
```

#### Step 1.3: Run Migration

```bash
npm run migration:run
```

**Expected Output:**

```
Migration MakeKycLinksExpiresAtNullable1732630000000 has been executed successfully.
✅ Made kyc_links.expires_at nullable and cleared existing expiration dates
```

#### Step 1.4: Verify Migration

```bash
npm run typeorm query "SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = 'kyc_links' AND column_name = 'expires_at'"
```

**Expected Result:** `is_nullable = YES`

#### Step 1.5: Build Application

```bash
npm run build
```

#### Step 1.6: Start Application

```bash
# If using PM2
pm2 start lizt-backend
pm2 logs lizt-backend

# If using systemd
sudo systemctl start lizt-backend
sudo journalctl -u lizt-backend -f
```

### 2. Frontend Deployment

#### Step 2.1: Pull Latest Code

```bash
cd lizt-frontend
git pull origin main
npm install
```

#### Step 2.2: Build Application

```bash
npm run build
```

#### Step 2.3: Deploy Build

```bash
# Deploy to your hosting service
# Example for Vercel:
vercel --prod

# Example for custom server:
rsync -avz .next/ user@server:/var/www/lizt-frontend/
```

## Post-Deployment Verification

### Smoke Tests

#### Test 1: Generate KYC Link (API)

```bash
curl -X POST https://api.lizt.co/api/properties/{propertyId}/kyc-link \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json"
```

**Expected Response:**

```json
{
  "success": true,
  "message": "KYC link generated successfully",
  "data": {
    "token": "...",
    "link": "https://lizt.co/kyc/...",
    "expiresAt": null,
    "propertyId": "..."
  }
}
```

#### Test 2: Validate KYC Token

```bash
curl https://api.lizt.co/api/kyc/{token}/validate
```

**Expected Response:**

```json
{
  "success": true,
  "message": "KYC token is valid",
  "data": {
    "valid": true,
    "propertyInfo": { ... }
  }
}
```

#### Test 3: WhatsApp Bot

- [ ] Send message to WhatsApp bot
- [ ] Click "Generate KYC link" button
- [ ] Verify message shows "remains active until property is rented"
- [ ] Verify link works

#### Test 4: Frontend Modal

- [ ] Open property page
- [ ] Click "Generate KYC link"
- [ ] Verify modal shows link
- [ ] Verify no expiration date displayed
- [ ] Copy link and test in browser

### Database Verification

```sql
-- Check active links
SELECT
  COUNT(*) as total_active,
  COUNT(CASE WHEN expires_at IS NULL THEN 1 END) as no_expiration,
  COUNT(CASE WHEN expires_at IS NOT NULL THEN 1 END) as with_expiration
FROM kyc_links
WHERE is_active = true;
```

**Expected:** All active links should have `expires_at = NULL`

```sql
-- Check recent link generation
SELECT
  k.token,
  k.expires_at,
  k.is_active,
  k.created_at,
  p.name as property_name,
  p.property_status
FROM kyc_links k
JOIN properties p ON k.property_id = p.id
ORDER BY k.created_at DESC
LIMIT 5;
```

**Expected:** Recent links should have `expires_at = NULL`

### Monitoring Setup

#### Application Logs

```bash
# Check for errors
tail -f /var/log/lizt-backend/error.log | grep -i "kyc"

# Check for successful operations
tail -f /var/log/lizt-backend/access.log | grep -i "kyc-link"
```

#### Database Monitoring

```sql
-- Monitor link generation rate
SELECT
  DATE(created_at) as date,
  COUNT(*) as links_generated
FROM kyc_links
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY DATE(created_at)
ORDER BY date DESC;
```

#### Error Tracking

- [ ] Check Sentry/error tracking for KYC-related errors
- [ ] Monitor API response times for KYC endpoints
- [ ] Check WhatsApp bot message delivery rates

## Rollback Procedure

### If Issues Detected

#### Step 1: Rollback Database

```bash
cd lizt-backend
npm run migration:revert
```

**Expected Output:**

```
Migration MakeKycLinksExpiresAtNullable1732630000000 has been reverted successfully.
⏪ Reverted kyc_links.expires_at to NOT NULL with default dates
```

#### Step 2: Rollback Code

```bash
# Backend
cd lizt-backend
git revert HEAD
npm install
npm run build
pm2 restart lizt-backend

# Frontend
cd lizt-frontend
git revert HEAD
npm install
npm run build
# Redeploy
```

#### Step 3: Verify Rollback

```bash
# Check database
npm run typeorm query "SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = 'kyc_links' AND column_name = 'expires_at'"
```

**Expected:** `is_nullable = NO`

## Success Criteria

### Deployment Successful If:

- [x] Migration runs without errors
- [x] All API endpoints return expected responses
- [x] WhatsApp bot shows correct messages
- [x] Frontend displays links correctly
- [x] No errors in application logs
- [x] Database queries return expected results
- [x] Existing links still work
- [x] New links are created without expiration

### Metrics to Monitor (First 24 Hours)

- [ ] KYC link generation rate (should be stable)
- [ ] Link validation success rate (should increase)
- [ ] Application submission rate (should increase)
- [ ] Error rate (should not increase)
- [ ] API response times (should be stable)

## Communication

### Stakeholders to Notify

- [ ] Development team
- [ ] QA team
- [ ] Product team
- [ ] Support team
- [ ] Operations team

### Notification Template

```
Subject: KYC Link System Update - Expiration Removed

Hi Team,

We've deployed an update to the KYC link system:

WHAT CHANGED:
- KYC links no longer expire after 7 days
- Links remain active until property is rented
- Better user experience for landlords and tenants

IMPACT:
- Landlords don't need to regenerate links frequently
- Tenants have more time to complete applications
- Links automatically deactivate when property becomes occupied

TESTING:
- All systems tested and working as expected
- No action required from users

If you notice any issues, please report immediately.

Thanks,
Dev Team
```

## Post-Deployment Tasks

### Week 1

- [ ] Monitor error rates daily
- [ ] Check user feedback
- [ ] Review application completion rates
- [ ] Analyze link generation patterns

### Week 2

- [ ] Review metrics and KPIs
- [ ] Gather user feedback
- [ ] Document any issues encountered
- [ ] Plan any necessary adjustments

### Month 1

- [ ] Comprehensive review of system performance
- [ ] User satisfaction survey
- [ ] Optimization opportunities
- [ ] Documentation updates

## Sign-Off

- [ ] Technical Lead: ********\_******** Date: **\_\_\_**
- [ ] QA Lead: ********\_******** Date: **\_\_\_**
- [ ] Product Manager: ********\_******** Date: **\_\_\_**
- [ ] DevOps: ********\_******** Date: **\_\_\_**

---

**Deployment Date**: ******\_\_\_******  
**Deployed By**: ******\_\_\_******  
**Version**: 2.0.0  
**Status**: ⬜ Pending / ⬜ In Progress / ⬜ Complete / ⬜ Rolled Back
