# Backend Changes Complete - KYC Form Integration

## ✅ Changes Implemented

### 1. Updated CreateKYCApplicationDto

**File:** `lizt-backend/src/kyc-links/dto/create-kyc-application.dto.ts`

Added the following optional fields:

- `religion` - Personal religious affiliation
- `reference1_email` - Next of kin email address
- `employer_phone_number` - Work phone number
- `length_of_employment` - Duration of current employment
- `business_duration` - Duration of business operation (for self-employed)
- `intended_use_of_property` - Residential/Commercial/Mixed Use
- `number_of_occupants` - Number of people living in property
- `parking_needs` - Parking space requirements
- `proposed_rent_amount` - Tenant's proposed rent offer
- `rent_payment_frequency` - Monthly/Quarterly/Bi-Annually/Annually
- `additional_notes` - Any additional information from tenant
- `passport_photo_url` - Cloudinary URL for passport photo
- `id_document_url` - Cloudinary URL for ID document
- `employment_proof_url` - Cloudinary URL for employment proof

### 2. Updated KYCApplication Entity

**File:** `lizt-backend/src/kyc-links/entities/kyc-application.entity.ts`

Added corresponding database columns for all new fields (all nullable).

### 3. Created Migration

**File:** `lizt-backend/src/migrations/1731350000000-AddKycApplicationFields.ts`

Migration to add 14 new columns to the `kyc_applications` table:

- All columns are nullable (optional)
- Includes rollback functionality
- Uses `IF NOT EXISTS` to prevent errors if columns already exist

### 4. Updated KYCApplicationService

**File:** `lizt-backend/src/kyc-links/kyc-application.service.ts`

Updated `submitKYCApplication` method to:

- Accept all new fields from the DTO
- Conditionally add them to the application data (only if provided)
- Store them in the database

### 5. Created Test Suite

**File:** `lizt-backend/src/test/kyc-links/kyc-new-fields.spec.ts`

Comprehensive tests covering:

- Submission with all new fields
- Self-employed with business duration
- Minimal submission (only required fields)
- Verification that optional fields are handled correctly

## 🚀 How to Deploy

### Step 1: Run the Migration

```bash
# Development
npm run migration:run

# Production
npm run migration:run:prod
```

### Step 2: Verify Migration

```sql
-- Check that new columns exist
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'kyc_applications'
AND column_name IN (
  'religion',
  'reference1_email',
  'employer_phone_number',
  'length_of_employment',
  'business_duration',
  'intended_use_of_property',
  'number_of_occupants',
  'parking_needs',
  'proposed_rent_amount',
  'rent_payment_frequency',
  'additional_notes',
  'passport_photo_url',
  'id_document_url',
  'employment_proof_url'
);
```

### Step 3: Restart Backend Service

```bash
# Development
npm run start:dev

# Production
pm2 restart lizt-backend
```

### Step 4: Test End-to-End

1. Submit a KYC form from the frontend with all fields filled
2. Verify data is stored in the database
3. Check that the application appears in the landlord dashboard
4. Verify tenant attachment works with the new fields

## 📊 Database Schema Changes

### New Columns Added to `kyc_applications` Table

| Column Name              | Type    | Nullable | Description                 |
| ------------------------ | ------- | -------- | --------------------------- |
| religion                 | varchar | YES      | Religious affiliation       |
| reference1_email         | varchar | YES      | Next of kin email           |
| employer_phone_number    | varchar | YES      | Work phone number           |
| length_of_employment     | varchar | YES      | Employment duration         |
| business_duration        | varchar | YES      | Business operation duration |
| intended_use_of_property | varchar | YES      | Property usage type         |
| number_of_occupants      | varchar | YES      | Number of occupants         |
| parking_needs            | varchar | YES      | Parking requirements        |
| proposed_rent_amount     | varchar | YES      | Proposed rent amount        |
| rent_payment_frequency   | varchar | YES      | Payment frequency           |
| additional_notes         | text    | YES      | Additional information      |
| passport_photo_url       | varchar | YES      | Passport photo URL          |
| id_document_url          | varchar | YES      | ID document URL             |
| employment_proof_url     | varchar | YES      | Employment proof URL        |

## 🔄 API Changes

### POST /api/kyc/:token/submit

The endpoint now accepts additional optional fields in the request body:

```json
{
  "first_name": "John",
  "last_name": "Doe",
  "phone_number": "+2348012345678",
  "email": "john@example.com",

  // NEW FIELDS
  "religion": "Christianity",
  "reference1_email": "jane@example.com",
  "employer_phone_number": "+2348087654321",
  "length_of_employment": "3 years",
  "business_duration": "5 years",
  "intended_use_of_property": "Residential",
  "number_of_occupants": "3",
  "parking_needs": "2 car spaces",
  "proposed_rent_amount": "1000000",
  "rent_payment_frequency": "Annually",
  "additional_notes": "Prefer ground floor",
  "passport_photo_url": "https://cloudinary.com/...",
  "id_document_url": "https://cloudinary.com/...",
  "employment_proof_url": "https://cloudinary.com/..."
}
```

### Response Format (Unchanged)

```json
{
  "success": true,
  "message": "KYC application submitted successfully",
  "data": {
    "applicationId": "uuid",
    "status": "pending"
  }
}
```

## ✅ Backward Compatibility

- All new fields are optional
- Existing API calls without new fields will continue to work
- Frontend can gradually adopt new fields
- No breaking changes to existing functionality

## 🧪 Testing Checklist

- [x] DTO accepts all new fields
- [x] Entity has all new columns
- [x] Migration created and tested
- [x] Service handles new fields correctly
- [x] Unit tests pass
- [ ] Integration tests pass (run after deployment)
- [ ] End-to-end test with frontend
- [ ] Verify data persistence
- [ ] Verify tenant attachment works
- [ ] Verify landlord can view all fields

## 📝 Notes

1. **Document URLs**: The frontend uploads files to Cloudinary and sends the URLs. The backend stores these URLs for later retrieval.

2. **Tenancy Information**: Fields like `intended_use_of_property`, `proposed_rent_amount`, etc. are stored but not currently used in the tenant attachment process. They can be used for:
   - Landlord review before approval
   - Analytics and reporting
   - Future automated rent calculation

3. **Religion Field**: Added to match the TenantKyc entity structure for consistency.

4. **Phone Number Validation**: `employer_phone_number` uses the same validation as other phone fields (Nigerian format).

5. **Monetary Fields**: `proposed_rent_amount` is stored as a string to preserve the exact value without floating-point issues.

## 🔧 Rollback Plan

If issues arise, rollback the migration:

```bash
npm run migration:revert
```

This will remove all new columns from the database.

## 📞 Support

If you encounter any issues:

1. Check the migration ran successfully
2. Verify all columns exist in the database
3. Check backend logs for errors
4. Test with minimal data first (only required fields)
5. Gradually add optional fields to isolate issues

## 🎉 Success Criteria

- ✅ Migration runs without errors
- ✅ All new fields are stored in database
- ✅ Frontend can submit forms with new fields
- ✅ Landlord can view all submitted information
- ✅ Tenant attachment process works correctly
- ✅ No breaking changes to existing functionality
