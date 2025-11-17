import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { KYCApplicationService } from '../../kyc-links/kyc-application.service';
import {
  KYCApplication,
  ApplicationStatus,
} from '../../kyc-links/entities/kyc-application.entity';
import { KYCLink } from '../../kyc-links/entities/kyc-link.entity';
import { Property } from '../../properties/entities/property.entity';
import { CreateKYCApplicationDto } from '../../kyc-links/dto/create-kyc-application.dto';
import { EventsGateway } from '../../events/events.gateway';

describe('KYC Application Service - New Fields', () => {
  let service: KYCApplicationService;
  let kycApplicationRepository: Repository<KYCApplication>;
  let kycLinkRepository: Repository<KYCLink>;

  const mockKycApplicationRepository = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    find: jest.fn(),
  };

  const mockKycLinkRepository = {
    findOne: jest.fn(),
  };

  const mockPropertyRepository = {
    findOne: jest.fn(),
  };

  const mockEventsGateway = {
    emitKYCSubmission: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KYCApplicationService,
        {
          provide: getRepositoryToken(KYCApplication),
          useValue: mockKycApplicationRepository,
        },
        {
          provide: getRepositoryToken(KYCLink),
          useValue: mockKycLinkRepository,
        },
        {
          provide: getRepositoryToken(Property),
          useValue: mockPropertyRepository,
        },
        {
          provide: EventsGateway,
          useValue: mockEventsGateway,
        },
      ],
    }).compile();

    service = module.get<KYCApplicationService>(KYCApplicationService);
    kycApplicationRepository = module.get<Repository<KYCApplication>>(
      getRepositoryToken(KYCApplication),
    );
    kycLinkRepository = module.get<Repository<KYCLink>>(
      getRepositoryToken(KYCLink),
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('submitKYCApplication with new fields', () => {
    it('should accept and store all new fields', async () => {
      // Arrange
      const token = 'valid-token-123';
      const mockKycLink = {
        id: 'link-123',
        property_id: 'property-123',
        token,
        expires_at: new Date(Date.now() + 86400000),
        is_active: true,
      };

      const mockProperty = {
        id: 'property-123',
        owner_id: 'landlord-123',
        property_status: 'vacant',
      };

      const kycDataWithNewFields: CreateKYCApplicationDto = {
        // Required fields
        first_name: 'John',
        last_name: 'Doe',
        phone_number: '+2348012345678',

        // Optional personal fields
        email: 'john@example.com',
        contact_address: '123 Main Street, Lagos, Nigeria',
        date_of_birth: '1990-01-01',
        gender: 'male' as any,
        nationality: 'Nigeria',
        state_of_origin: 'Lagos',
        local_government_area: 'Ikeja',
        marital_status: 'single' as any,

        // NEW: Religion
        religion: 'Christianity',

        // Employment fields
        employment_status: 'employed' as any,
        occupation: 'Software Engineer',
        job_title: 'Senior Developer',
        employer_name: 'Tech Corp',
        employer_address: '123 Tech Street, Lagos',
        monthly_net_income: '500000',

        // NEW: Additional employment fields
        employer_phone_number: '+2348087654321',
        length_of_employment: '3 years',

        // Reference 1 (Next of Kin)
        reference1_name: 'Jane Doe',
        reference1_address: '456 Family Street, Lagos',
        reference1_relationship: 'Sister',
        reference1_phone_number: '+2348011111111',

        // NEW: Reference 1 email
        reference1_email: 'jane@example.com',

        // NEW: Tenancy information
        intended_use_of_property: 'Residential',
        number_of_occupants: '3',
        proposed_rent_amount: '1000000',
        rent_payment_frequency: 'Annually',
        additional_notes: 'Prefer ground floor unit',

        // NEW: Document URLs
        passport_photo_url: 'https://cloudinary.com/passport.jpg',
        id_document_url: 'https://cloudinary.com/id.pdf',
        employment_proof_url: 'https://cloudinary.com/employment.pdf',
      };

      const mockSavedApplication = {
        id: 'app-123',
        ...kycDataWithNewFields,
        kyc_link_id: mockKycLink.id,
        property_id: mockKycLink.property_id,
        status: ApplicationStatus.PENDING,
        created_at: new Date(),
      };

      mockKycLinkRepository.findOne.mockResolvedValue(mockKycLink);
      mockKycApplicationRepository.findOne
        .mockResolvedValueOnce(null) // No existing application
        .mockResolvedValueOnce({
          ...mockSavedApplication,
          property: mockProperty,
          kyc_link: mockKycLink,
        }); // Return with relations
      mockKycApplicationRepository.create.mockReturnValue(mockSavedApplication);
      mockKycApplicationRepository.save.mockResolvedValue(mockSavedApplication);

      // Act
      const result = await service.submitKYCApplication(
        token,
        kycDataWithNewFields,
      );

      // Assert
      expect(result).toBeDefined();
      expect(mockKycApplicationRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          // Verify new fields are included
          religion: 'Christianity',
          reference1_email: 'jane@example.com',
          employer_phone_number: '+2348087654321',
          length_of_employment: '3 years',
          intended_use_of_property: 'Residential',
          number_of_occupants: '3',
          proposed_rent_amount: '1000000',
          rent_payment_frequency: 'Annually',
          additional_notes: 'Prefer ground floor unit',
          passport_photo_url: 'https://cloudinary.com/passport.jpg',
          id_document_url: 'https://cloudinary.com/id.pdf',
          employment_proof_url: 'https://cloudinary.com/employment.pdf',
        }),
      );
    });

    it('should handle self-employed with business duration', async () => {
      // Arrange
      const token = 'valid-token-456';
      const mockKycLink = {
        id: 'link-456',
        property_id: 'property-456',
        token,
        expires_at: new Date(Date.now() + 86400000),
        is_active: true,
      };

      const kycDataSelfEmployed: CreateKYCApplicationDto = {
        first_name: 'Jane',
        last_name: 'Smith',
        phone_number: '+2348098765432',
        employment_status: 'self-employed' as any,
        occupation: 'Retail',
        employer_name: "Jane's Boutique",
        employer_address: '789 Market Street, Lagos',
        monthly_net_income: '300000',

        // NEW: Business duration
        business_duration: '5 years',
      };

      const mockSavedApplication = {
        id: 'app-456',
        ...kycDataSelfEmployed,
        kyc_link_id: mockKycLink.id,
        property_id: mockKycLink.property_id,
        status: ApplicationStatus.PENDING,
      };

      mockKycLinkRepository.findOne.mockResolvedValue(mockKycLink);
      mockKycApplicationRepository.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          ...mockSavedApplication,
          property: { id: 'property-456', owner_id: 'landlord-456' },
          kyc_link: mockKycLink,
        });
      mockKycApplicationRepository.create.mockReturnValue(mockSavedApplication);
      mockKycApplicationRepository.save.mockResolvedValue(mockSavedApplication);

      // Act
      const result = await service.submitKYCApplication(
        token,
        kycDataSelfEmployed,
      );

      // Assert
      expect(result).toBeDefined();
      expect(mockKycApplicationRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          business_duration: '5 years',
        }),
      );
    });

    it('should handle optional fields being omitted', async () => {
      // Arrange
      const token = 'valid-token-789';
      const mockKycLink = {
        id: 'link-789',
        property_id: 'property-789',
        token,
        expires_at: new Date(Date.now() + 86400000),
        is_active: true,
      };

      const minimalKycData: CreateKYCApplicationDto = {
        // Only required fields
        first_name: 'Minimal',
        last_name: 'User',
        phone_number: '+2348055555555',
      };

      const mockSavedApplication = {
        id: 'app-789',
        ...minimalKycData,
        kyc_link_id: mockKycLink.id,
        property_id: mockKycLink.property_id,
        status: ApplicationStatus.PENDING,
      };

      mockKycLinkRepository.findOne.mockResolvedValue(mockKycLink);
      mockKycApplicationRepository.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          ...mockSavedApplication,
          property: { id: 'property-789', owner_id: 'landlord-789' },
          kyc_link: mockKycLink,
        });
      mockKycApplicationRepository.create.mockReturnValue(mockSavedApplication);
      mockKycApplicationRepository.save.mockResolvedValue(mockSavedApplication);

      // Act
      const result = await service.submitKYCApplication(token, minimalKycData);

      // Assert
      expect(result).toBeDefined();
      expect(mockKycApplicationRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          first_name: 'Minimal',
          last_name: 'User',
          phone_number: '+2348055555555',
        }),
      );
      // Verify new optional fields are not included when not provided
      const createCall = mockKycApplicationRepository.create.mock.calls[0][0];
      expect(createCall.religion).toBeUndefined();
      expect(createCall.intended_use_of_property).toBeUndefined();
    });
  });
});
