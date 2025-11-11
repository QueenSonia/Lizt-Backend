# KYC Backend Extension Guide

## Overview

The frontend KYC form has been updated to collect additional fields. This guide shows exactly what needs to be added to the backend to support all the new fields.

## Step 1: Update CreateKYCApplicationDto

**File:** `lizt-backend/src/kyc-links/dto/create-kyc-application.dto.ts`

Add these fields to the existing DTO:

```typescript
import {
  IsString,
  IsEmail,
  IsNotEmpty,
  IsDateString,
  IsOptional,
  IsPhoneNumber,
  IsNumberString,
  ValidateIf,
  IsIn,
  IsInt,
  Min,
} from 'class-validator';

export class CreateKYCApplicationDto {
  // ... existing fields ...

  // Additional Personal Information
  @IsOptional()
  @IsString()
  religion?: string;

  // Additional Reference Information
  @IsOptional()
  @IsEmail()
  reference1_email?: string;

  // Additional Employment Information
  @IsOptional()
  @IsPhoneNumber('NG')
  employer_phone_number?: string;

  @IsOptional()
  @IsString()
  length_of_employment?: string;

  @IsOptional()
  @IsString()
  business_duration?: string;

  // Tenancy Information
  @IsOptional()
  @IsString()
  intended_use_of_property?: string;

  @IsOptional()
  @IsNumberString()
  number_of_occupants?: string;

  @IsOptional()
  @IsString()
  parking_needs?: string;

  @IsOptional()
  @IsNumberString()
  proposed_rent_amount?: string;

  @IsOptional()
  @IsString()
  rent_payment_frequency?: string;

  @IsOptional()
  @IsString()
  additional_notes?: string;

  // Document URLs (from Cloudinary)
  @IsOptional()
  @IsString()
  passport_photo_url?: string;

  @IsOptional()
  @IsString()
  id_document_url?: string;

  @IsOptional()
  @IsString()
  employment_proof_url?: string;
}
```

## Step 2: Update KYCApplication Entity

**File:** `lizt-backend/src/kyc-links/entities/kyc-application.entity.ts`

Add these columns to the existing entity:

```typescript
@Entity({ name: 'kyc_applications' })
export class KYCApplication extends BaseEntity {
  // ... existing columns ...

  // Additional Personal Information
  @Column({ type: 'varchar', nullable: true })
  religion?: string;

  // Additional Reference Information
  @Column({ type: 'varchar', nullable: true })
  reference1_email?: string;

  // Additional Employment Information
  @Column({ type: 'varchar', nullable: true })
  employer_phone_number?: string;

  @Column({ type: 'varchar', nullable: true })
  length_of_employment?: string;

  @Column({ type: 'varchar', nullable: true })
  business_duration?: string;

  // Tenancy Information
  @Column({ type: 'varchar', nullable: true })
  intended_use_of_property?: string;

  @Column({ type: 'varchar', nullable: true })
  number_of_occupants?: string;

  @Column({ type: 'varchar', nullable: true })
  parking_needs?: string;

  @Column({ type: 'varchar', nullable: true })
  proposed_rent_amount?: string;

  @Column({ type: 'varchar', nullable: true })
  rent_payment_frequency?: string;

  @Column({ type: 'text', nullable: true })
  additional_notes?: string;

  // Document URLs
  @Column({ type: 'varchar', nullable: true })
  passport_photo_url?: string;

  @Column({ type: 'varchar', nullable: true })
  id_document_url?: string;

  @Column({ type: 'varchar', nullable: true })
  employment_proof_url?: string;
}
```

## Step 3: Create and Run Migration

Generate a new migration:

```bash
npm run migration:generate -- -n AddKycApplicationFields
```

This will create a migration file. Review it to ensure it includes all the new columns:

```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddKycApplicationFields1234567890123
  implements MigrationInterface
{
  name = 'AddKycApplicationFields1234567890123';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "kyc_applications" 
            ADD COLUMN "religion" varchar,
            ADD COLUMN "reference1_email" varchar,
            ADD COLUMN "employer_phone_number" varchar,
            ADD COLUMN "length_of_employment" varchar,
            ADD COLUMN "business_duration" varchar,
            ADD COLUMN "intended_use_of_property" varchar,
            ADD COLUMN "number_of_occupants" varchar,
            ADD COLUMN "parking_needs" varchar,
            ADD COLUMN "proposed_rent_amount" varchar,
            ADD COLUMN "rent_payment_frequency" varchar,
            ADD COLUMN "additional_notes" text,
            ADD COLUMN "passport_photo_url" varchar,
            ADD COLUMN "id_document_url" varchar,
            ADD COLUMN "employment_proof_url" varchar
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "kyc_applications" 
            DROP COLUMN "religion",
            DROP COLUMN "reference1_email",
            DROP COLUMN "employer_phone_number",
            DROP COLUMN "length_of_employment",
            DROP COLUMN "business_duration",
            DROP COLUMN "intended_use_of_property",
            DROP COLUMN "number_of_occupants",
            DROP COLUMN "parking_needs",
            DROP COLUMN "proposed_rent_amount",
            DROP COLUMN "rent_payment_frequency",
            DROP COLUMN "additional_notes",
            DROP COLUMN "passport_photo_url",
            DROP COLUMN "id_document_url",
            DROP COLUMN "employment_proof_url"
        `);
  }
}
```

Run the migration:

```bash
npm run migration:run
```

## Step 4: Update Service Layer (Optional)

**File:** `lizt-backend/src/kyc-links/kyc-application.service.ts`

The service should automatically handle the new fields since they're in the DTO and entity. However, you may want to add specific business logic:

```typescript
async submitKYCApplication(
  token: string,
  createKYCApplicationDto: CreateKYCApplicationDto,
): Promise<KYCApplication> {
  // ... existing validation ...

  // Create application with all fields
  const application = this.kycApplicationRepository.create({
    ...createKYCApplicationDto,
    kyc_link_id: kycLink.id,
    property_id: kycLink.property_id,
    status: ApplicationStatus.PENDING,
  });

  // Save application
  await this.kycApplicationRepository.save(application);

  // ... existing notification logic ...

  return application;
}
```

## Step 5: Update Response DTOs (Optional)

If you have response DTOs, update them to include the new fields:

**File:** `lizt-backend/src/kyc-links/dto/kyc-application-response.dto.ts`

```typescript
export class KYCApplicationResponseDto {
  // ... existing fields ...

  religion?: string;
  reference1_email?: string;
  employer_phone_number?: string;
  length_of_employment?: string;
  business_duration?: string;
  intended_use_of_property?: string;
  number_of_occupants?: string;
  parking_needs?: string;
  proposed_rent_amount?: string;
  rent_payment_frequency?: string;
  additional_notes?: string;
  passport_photo_url?: string;
  id_document_url?: string;
  employment_proof_url?: string;
}
```

## Step 6: Update Tenant Attachment Logic

**File:** `lizt-backend/src/kyc-links/kyc-application.service.ts`

When attaching a KYC application to a tenant account, ensure the new fields are transferred:

```typescript
async attachApplicationToTenant(
  applicationId: string,
  tenantId: string,
): Promise<void> {
  const application = await this.kycApplicationRepository.findOne({
    where: { id: applicationId },
  });

  // ... existing validation ...

  // Update tenant profile with KYC data including new fields
  await this.tenantService.updateTenantProfile(tenantId, {
    // ... existing fields ...
    religion: application.religion,
    // Note: Tenancy preferences might go to a separate table
  });

  // Update application status
  application.tenant_id = tenantId;
  application.status = ApplicationStatus.APPROVED;
  await this.kycApplicationRepository.save(application);
}
```

## Step 7: Testing

### Test Cases

1. **Submit with all fields:**

```bash
curl -X POST http://localhost:3000/api/kyc/{token}/submit \
  -H "Content-Type: application/json" \
  -d '{
    "first_name": "John",
    "last_name": "Doe",
    "phone_number": "+2348012345678",
    "email": "john@example.com",
    "religion": "Christianity",
    "employment_status": "employed",
    "employer_name": "Tech Corp",
    "employer_phone_number": "+2348087654321",
    "intended_use_of_property": "Residential",
    "number_of_occupants": "3",
    "proposed_rent_amount": "500000"
  }'
```

2. **Submit with only required fields:**

```bash
curl -X POST http://localhost:3000/api/kyc/{token}/submit \
  -H "Content-Type: application/json" \
  -d '{
    "first_name": "Jane",
    "last_name": "Smith",
    "phone_number": "+2348012345678"
  }'
```

3. **Verify data is stored:**

```sql
SELECT * FROM kyc_applications WHERE id = 'application-id';
```

### Validation Tests

- [ ] All new fields accept valid data
- [ ] Optional fields can be omitted
- [ ] Invalid data is rejected with proper error messages
- [ ] Document URLs are stored correctly
- [ ] Tenancy information is stored correctly
- [ ] Data is properly transferred when attaching to tenant

## Alternative Approach: JSON Column

If you prefer not to add many columns, you can store tenancy preferences as JSON:

```typescript
@Column({ type: 'jsonb', nullable: true })
tenancy_preferences?: {
  intendedUseOfProperty?: string;
  numberOfOccupants?: string;
  parkingNeeds?: string;
  proposedRentAmount?: string;
  rentPaymentFrequency?: string;
  additionalNotes?: string;
};

@Column({ type: 'jsonb', nullable: true })
documents?: {
  passportPhotoUrl?: string;
  idDocumentUrl?: string;
  employmentProofUrl?: string;
};
```

This approach requires less migration work but makes querying more complex.

## Rollback Plan

If you need to rollback:

```bash
npm run migration:revert
```

This will remove all the new columns.

## Questions?

Contact the frontend team if you need clarification on any field's purpose or expected values.
