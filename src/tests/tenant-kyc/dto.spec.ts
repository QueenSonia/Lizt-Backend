import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateTenantKycDto } from 'src/tenant-kyc/dto';
import { UpdateTenantKycDto } from 'src/tenant-kyc/dto';
import {
  BulkDeleteTenantKycDto,
  ParseTenantKycQueryDto,
} from 'src/tenant-kyc/dto/others.dto';
import {
  Gender,
  MaritalStatus,
  EmploymentStatus,
} from 'src/tenant-kyc/entities/tenant-kyc.entity';

describe('TenantKyc DTOs', () => {
  const validBaseDto = {
    first_name: 'John',
    last_name: 'Doe',
    email: 'john.doe@example.com',
    phone_number: '+2348148696119',
    date_of_birth: '1996-04-22T11:03:13.157Z',
    gender: Gender.MALE,
    nationality: 'Nigerian',
    current_residence: 'Lagos',
    state_of_origin: 'Lagos',
    local_government_area: 'Ikeja',
    marital_status: MaritalStatus.SINGLE,
    religion: 'Christianity',
    employment_status: EmploymentStatus.EMPLOYED,
    occupation: 'Software Engineer',
    job_title: 'Senior Developer',
    employer_name: 'Tech Company',
    employer_address: '123 Tech Street',
    employer_phone_number: '+2348148696120',
    monthly_net_income: '500000',
    reference1_name: 'Jane Smith',
    reference1_address: '456 Reference St',
    reference1_relationship: 'Friend',
    reference1_phone_number: '+2348148696121',
    landlord_id: '123e4567-e89b-12d3-a456-426614174001',
  };

  describe('CreateTenantKycDto', () => {
    it('should pass validation with valid data', async () => {
      const dto = plainToInstance(CreateTenantKycDto, validBaseDto);
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    describe('first_name validation', () => {
      it('should fail when first_name is missing', async () => {
        const { first_name, ...rest } = validBaseDto;
        const dto = plainToInstance(CreateTenantKycDto, rest);
        const errors = await validate(dto);
        expect(errors.length).toBeGreaterThan(0);
        expect(errors[0].property).toBe('first_name');
      });

      it('should fail when first_name is empty string', async () => {
        const dto = plainToInstance(CreateTenantKycDto, {
          ...validBaseDto,
          first_name: '',
        });
        const errors = await validate(dto);
        expect(errors.length).toBeGreaterThan(0);
      });

      it('should fail when first_name is not a string', async () => {
        const dto = plainToInstance(CreateTenantKycDto, {
          ...validBaseDto,
          first_name: 123,
        });
        const errors = await validate(dto);
        expect(errors.length).toBeGreaterThan(0);
      });
    });

    describe('last_name validation', () => {
      it('should fail when last_name is missing', async () => {
        const { last_name, ...rest } = validBaseDto;
        const dto = plainToInstance(CreateTenantKycDto, rest);
        const errors = await validate(dto);
        expect(errors.length).toBeGreaterThan(0);
        expect(errors[0].property).toBe('last_name');
      });

      it('should fail when last_name is empty string', async () => {
        const dto = plainToInstance(CreateTenantKycDto, {
          ...validBaseDto,
          last_name: '',
        });
        const errors = await validate(dto);
        expect(errors.length).toBeGreaterThan(0);
      });
    });

    describe('email and phone_number validation', () => {
      it('should pass with only email', async () => {
        const { phone_number, ...rest } = validBaseDto;
        const dto = plainToInstance(CreateTenantKycDto, rest);
        const errors = await validate(dto);
        expect(errors.length).toBe(0);
      });

      it('should pass with only phone_number', async () => {
        const { email, ...rest } = validBaseDto;
        const dto = plainToInstance(CreateTenantKycDto, rest);
        const errors = await validate(dto);
        expect(errors.length).toBe(0);
      });

      it('should pass with both email and phone_number', async () => {
        const dto = plainToInstance(CreateTenantKycDto, validBaseDto);
        const errors = await validate(dto);
        expect(errors.length).toBe(0);
      });

      it('should fail when both email and phone_number are missing', async () => {
        const { email, phone_number, ...rest } = validBaseDto;
        const dto = plainToInstance(CreateTenantKycDto, rest);
        const errors = await validate(dto);
        expect(errors.length).toBeGreaterThan(0);
      });

      it('should fail with invalid email format', async () => {
        const dto = plainToInstance(CreateTenantKycDto, {
          ...validBaseDto,
          email: 'invalid-email',
        });
        const errors = await validate(dto);
        expect(errors.length).toBeGreaterThan(0);
      });

      it('should fail with invalid Nigerian phone number', async () => {
        const { email, ...rest } = validBaseDto;
        const dto = plainToInstance(CreateTenantKycDto, {
          ...rest,
          phone_number: '+1234567890',
        });
        const errors = await validate(dto);
        expect(errors.length).toBeGreaterThan(0);
      });
    });

    describe('date_of_birth validation', () => {
      it('should pass with valid ISO date string', async () => {
        const dto = plainToInstance(CreateTenantKycDto, validBaseDto);
        const errors = await validate(dto);
        expect(errors.length).toBe(0);
      });

      it('should fail when date_of_birth is missing', async () => {
        const { date_of_birth, ...rest } = validBaseDto;
        const dto = plainToInstance(CreateTenantKycDto, rest);
        const errors = await validate(dto);
        expect(errors.length).toBeGreaterThan(0);
      });

      it('should fail with invalid date format', async () => {
        const dto = plainToInstance(CreateTenantKycDto, {
          ...validBaseDto,
          date_of_birth: 'invalid-date',
        });
        const errors = await validate(dto);
        expect(errors.length).toBeGreaterThan(0);
      });
    });

    describe('gender validation', () => {
      it('should pass with valid gender values', async () => {
        for (const gender of Object.values(Gender)) {
          const dto = plainToInstance(CreateTenantKycDto, {
            ...validBaseDto,
            gender,
          });
          const errors = await validate(dto);
          expect(errors.length).toBe(0);
        }
      });

      it('should fail with invalid gender value', async () => {
        const dto = plainToInstance(CreateTenantKycDto, {
          ...validBaseDto,
          gender: 'invalid-gender',
        });
        const errors = await validate(dto);
        expect(errors.length).toBeGreaterThan(0);
      });
    });

    describe('marital_status validation', () => {
      it('should pass with valid marital status values', async () => {
        for (const status of Object.values(MaritalStatus)) {
          const dto = plainToInstance(CreateTenantKycDto, {
            ...validBaseDto,
            marital_status: status,
          });
          const errors = await validate(dto);
          expect(errors.length).toBe(0);
        }
      });

      it('should fail with invalid marital status', async () => {
        const dto = plainToInstance(CreateTenantKycDto, {
          ...validBaseDto,
          marital_status: 'invalid-status',
        });
        const errors = await validate(dto);
        expect(errors.length).toBeGreaterThan(0);
      });
    });

    describe('employment_status validation', () => {
      it('should pass with valid employment status values', async () => {
        for (const status of Object.values(EmploymentStatus)) {
          const dto = plainToInstance(CreateTenantKycDto, {
            ...validBaseDto,
            employment_status: status,
            job_title:
              status === EmploymentStatus.EMPLOYED ? 'Developer' : undefined,
            employer_name:
              status === EmploymentStatus.EMPLOYED ? 'Company' : undefined,
            employer_address:
              status === EmploymentStatus.EMPLOYED ? 'Address' : undefined,
            employer_phone_number:
              status === EmploymentStatus.EMPLOYED
                ? '+2348148696120'
                : undefined,
          });
          const errors = await validate(dto);
          expect(errors.length).toBe(0);
        }
      });

      it('should fail with invalid employment status', async () => {
        const dto = plainToInstance(CreateTenantKycDto, {
          ...validBaseDto,
          employment_status: 'invalid-status',
        });
        const errors = await validate(dto);
        expect(errors.length).toBeGreaterThan(0);
      });
    });

    describe('employment fields conditional validation', () => {
      it('should require employer fields when employment_status is employed', async () => {
        const dto = plainToInstance(CreateTenantKycDto, {
          ...validBaseDto,
          employment_status: EmploymentStatus.EMPLOYED,
          job_title: undefined,
          employer_name: undefined,
          employer_address: undefined,
          employer_phone_number: undefined,
        });
        const errors = await validate(dto);
        expect(errors.length).toBeGreaterThan(0);
      });

      it('should not require employer fields when employment_status is not employed', async () => {
        const dto = plainToInstance(CreateTenantKycDto, {
          ...validBaseDto,
          employment_status: EmploymentStatus.STUDENT,
          job_title: undefined,
          employer_name: undefined,
          employer_address: undefined,
          employer_phone_number: undefined,
        });
        const errors = await validate(dto);
        expect(errors.length).toBe(0);
      });
    });

    describe('monthly_net_income validation', () => {
      it('should pass with numeric string', async () => {
        const dto = plainToInstance(CreateTenantKycDto, {
          ...validBaseDto,
          monthly_net_income: '500000',
        });
        const errors = await validate(dto);
        expect(errors.length).toBe(0);
      });

      it('should fail with non-numeric string', async () => {
        const dto = plainToInstance(CreateTenantKycDto, {
          ...validBaseDto,
          monthly_net_income: 'not-a-number',
        });
        const errors = await validate(dto);
        expect(errors.length).toBeGreaterThan(0);
      });
    });

    describe('reference1 fields validation', () => {
      it('should require all reference1 fields', async () => {
        const { reference1_name, ...rest } = validBaseDto;
        const dto = plainToInstance(CreateTenantKycDto, rest);
        const errors = await validate(dto);
        expect(errors.length).toBeGreaterThan(0);
      });

      it('should validate reference1 phone number format', async () => {
        const dto = plainToInstance(CreateTenantKycDto, {
          ...validBaseDto,
          reference1_phone_number: 'invalid-phone',
        });
        const errors = await validate(dto);
        expect(errors.length).toBeGreaterThan(0);
      });
    });

    describe('reference2 fields validation', () => {
      it('should allow missing reference2 fields', async () => {
        const {
          reference1_name,
          reference1_address,
          reference1_relationship,
          reference1_phone_number,
          ...rest
        } = validBaseDto;
        const dto = plainToInstance(CreateTenantKycDto, rest);
        const errors = await validate(dto);
        expect(errors.length).toBe(0);
      });
    });

    describe('landlord_id validation', () => {
      it('should pass with valid UUID', async () => {
        const dto = plainToInstance(CreateTenantKycDto, validBaseDto);
        const errors = await validate(dto);
        expect(errors.length).toBe(0);
      });

      it('should fail with invalid UUID', async () => {
        const dto = plainToInstance(CreateTenantKycDto, {
          ...validBaseDto,
          landlord_id: 'invalid-uuid',
        });
        const errors = await validate(dto);
        expect(errors.length).toBeGreaterThan(0);
      });

      it('should fail when landlord_id is missing', async () => {
        const { landlord_id, ...rest } = validBaseDto;
        const dto = plainToInstance(CreateTenantKycDto, rest);
        const errors = await validate(dto);
        expect(errors.length).toBeGreaterThan(0);
      });
    });

    describe('optional fields', () => {
      it('should allow missing optional fields', async () => {
        const dto = plainToInstance(CreateTenantKycDto, {
          first_name: 'John',
          last_name: 'Doe',
          email: 'john@example.com',
          date_of_birth: '1996-04-22T11:03:13.157Z',
          gender: Gender.MALE,
          nationality: 'Nigerian',
          state_of_origin: 'Lagos',
          local_government_area: 'Ikeja',
          marital_status: MaritalStatus.SINGLE,
          employment_status: EmploymentStatus.STUDENT,
          occupation: 'Student',
          monthly_net_income: '100000',
          reference1_name: 'Jane Smith',
          reference1_address: '456 Reference St',
          reference1_relationship: 'Friend',
          reference1_phone_number: '+2348148696121',
          landlord_id: '123e4567-e89b-12d3-a456-426614174001',
        });
        const errors = await validate(dto);
        expect(errors.length).toBe(0);
      });
    });
  });

  describe('UpdateTenantKycDto', () => {
    it('should allow partial updates', async () => {
      const dto = plainToInstance(UpdateTenantKycDto, {
        first_name: 'Jane',
      });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should allow empty object', async () => {
      const dto = plainToInstance(UpdateTenantKycDto, {});
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should validate fields when provided', async () => {
      const dto = plainToInstance(UpdateTenantKycDto, {
        email: 'invalid-email',
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('should allow updating multiple fields', async () => {
      const dto = plainToInstance(UpdateTenantKycDto, {
        first_name: 'Jane',
        last_name: 'Smith',
        email: 'jane.smith@example.com',
      });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });
  });

  describe('ParseTenantKycQueryDto', () => {
    it('should pass with valid query parameters', async () => {
      const dto = plainToInstance(ParseTenantKycQueryDto, {
        page: 1,
        limit: 10,
        fields: 'id,first_name,email',
      });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should allow missing fields parameter', async () => {
      const dto = plainToInstance(ParseTenantKycQueryDto, {
        page: 1,
        limit: 10,
      });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should trim whitespace from fields', async () => {
      const dto = plainToInstance(
        ParseTenantKycQueryDto,
        { fields: '  id,first_name  ' },
        { enableImplicitConversion: true },
      );
      await validate(dto);
      expect(dto.fields).toBe('id,first_name');
    });

    it('should handle empty fields string', async () => {
      const dto = plainToInstance(ParseTenantKycQueryDto, {
        page: 1,
        limit: 10,
        fields: '',
      });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });
  });

  describe('BulkDeleteTenantKycDto', () => {
    it('should pass with valid UUID array', async () => {
      const dto = plainToInstance(BulkDeleteTenantKycDto, {
        ids: [
          '123e4567-e89b-12d3-a456-426614174001',
          '123e4567-e89b-12d3-a456-426614174002',
        ],
      });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should fail with empty array', async () => {
      const dto = plainToInstance(BulkDeleteTenantKycDto, {
        ids: [],
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('should fail with invalid UUIDs', async () => {
      const dto = plainToInstance(BulkDeleteTenantKycDto, {
        ids: ['invalid-uuid-1', 'invalid-uuid-2'],
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('should fail with mixed valid and invalid UUIDs', async () => {
      const dto = plainToInstance(BulkDeleteTenantKycDto, {
        ids: ['123e4567-e89b-12d3-a456-426614174001', 'invalid-uuid'],
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('should fail when ids is not an array', async () => {
      const dto = plainToInstance(BulkDeleteTenantKycDto, {
        ids: 'not-an-array',
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('should fail when ids is missing', async () => {
      const dto = plainToInstance(BulkDeleteTenantKycDto, {});
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });
  });
});
