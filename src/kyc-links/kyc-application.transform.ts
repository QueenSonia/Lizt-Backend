import { KYCApplication } from './entities/kyc-application.entity';

/**
 * Frontend-facing flat shape of a KYC application. This is the exact object
 * returned by `GET /api/kyc-applications/:id` (under `application`) and now
 * also embedded in the tenant-detail response so the frontend never has to
 * fetch the application separately.
 */
export type KycApplicationFrontendShape = ReturnType<
  typeof transformApplicationForFrontend
>;

/**
 * Transform a KYC application entity to the frontend-compatible format.
 *
 * Pure function (reads only the passed entity + its `property` / `offer_letters`
 * relations when loaded). Extracted out of KYCApplicationService so it can be
 * reused by TenantManagementService without a DI module cycle.
 */
export function transformApplicationForFrontend(application: KYCApplication) {
  return {
    id: application.id,
    tenantId: application.tenant_id,
    propertyId: application.property_id,
    status: application.status,
    firstName: application.first_name,
    lastName: application.last_name,
    email: application.email,
    contactAddress: application.contact_address,
    phoneNumber: application.phone_number,
    dateOfBirth: application.date_of_birth
      ? application.date_of_birth instanceof Date
        ? application.date_of_birth.toISOString().split('T')[0]
        : new Date(application.date_of_birth).toISOString().split('T')[0]
      : null, // Format as YYYY-MM-DD
    gender: application.gender,
    nationality: application.nationality,
    stateOfOrigin: application.state_of_origin,
    maritalStatus: application.marital_status,
    religion: application.religion,

    // Employment Info
    employmentStatus: application.employment_status,
    occupation: application.occupation,
    jobTitle: application.job_title,
    employerName: application.employer_name,
    workAddress: application.work_address,
    workPhoneNumber: application.work_phone_number,
    lengthOfEmployment: application.length_of_employment,
    monthlyNetIncome: application.monthly_net_income,

    // Self-employed specific fields
    natureOfBusiness: application.nature_of_business,
    businessName: application.business_name,
    businessAddress: application.business_address,
    businessDuration: application.business_duration,

    // Next of Kin
    nextOfKinFullName: application.next_of_kin_full_name,
    nextOfKinAddress: application.next_of_kin_address,
    nextOfKinRelationship: application.next_of_kin_relationship,
    nextOfKinPhoneNumber: application.next_of_kin_phone_number,
    nextOfKinEmail: application.next_of_kin_email,

    // Referral Agent
    referralAgentFullName: application.referral_agent_full_name,
    referralAgentPhoneNumber: application.referral_agent_phone_number,

    // Tenancy Info
    intendedUseOfProperty: application.intended_use_of_property,
    isFirstTimeTenant: application.is_first_time_tenant,
    numberOfPreviousResidences: application.number_of_previous_residences,
    numberOfOccupants: application.number_of_occupants,
    parkingNeeds: application.parking_needs,
    proposedRentAmount: application.proposed_rent_amount,
    rentPaymentFrequency: application.rent_payment_frequency,
    additionalNotes: application.additional_notes,

    // Documents
    passportPhotoUrl: application.passport_photo_url,
    idDocumentUrl: application.id_document_url,
    employmentProofUrl: application.employment_proof_url,
    businessProofUrl: application.business_proof_url,

    // Include property information if the relation is loaded
    property: application.property
      ? {
          name: application.property.name,
          address: application.property.location,
          status: application.property.property_status,
        }
      : undefined,
    submissionDate:
      application.created_at instanceof Date
        ? application.created_at.toISOString()
        : application.created_at,
    createdAt:
      application.created_at instanceof Date
        ? application.created_at.toISOString()
        : application.created_at,
    updatedAt:
      application.updated_at instanceof Date
        ? application.updated_at.toISOString()
        : application.updated_at,

    // Offer Letter Information
    offerLetterStatus:
      application.offer_letters && application.offer_letters.length > 0
        ? application.offer_letters.sort((a, b) => {
            // Sort by created_at desc (handling potential string/Date types)
            const dateA = new Date(a.created_at || 0).getTime();
            const dateB = new Date(b.created_at || 0).getTime();
            return dateB - dateA;
          })[0].status
        : undefined,

    offerLetter:
      application.offer_letters && application.offer_letters.length > 0
        ? (() => {
            const latestOffer = application.offer_letters.sort((a, b) => {
              const dateA = new Date(a.created_at || 0).getTime();
              const dateB = new Date(b.created_at || 0).getTime();
              return dateB - dateA;
            })[0];
            return {
              id: latestOffer.id,
              token: latestOffer.token,
              status: latestOffer.status,
              rentAmount: latestOffer.rent_amount,
              rentFrequency: latestOffer.rent_frequency,
              serviceCharge: latestOffer.service_charge,
              tenancyStartDate: latestOffer.tenancy_start_date,
              tenancyEndDate: latestOffer.tenancy_end_date,
              cautionDeposit: latestOffer.caution_deposit,
              legalFee: latestOffer.legal_fee,
              agencyFee: latestOffer.agency_fee,
              sentAt: latestOffer.sent_at
                ? latestOffer.sent_at instanceof Date
                  ? latestOffer.sent_at.toISOString()
                  : latestOffer.sent_at
                : undefined,
            };
          })()
        : undefined,
  };
}
