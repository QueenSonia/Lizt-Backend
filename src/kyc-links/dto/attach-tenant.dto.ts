// Lower-case rent-frequency enum used by `attachTenantFromOffer` to normalise
// offer-letter frequency strings via `mapOfferLetterFrequencyToRentFrequency`.
// Distinct from the title-case `RentFrequency` enum in
// `users/dto/attach-tenant-from-kyc.dto.ts` (different on-the-wire values).
export enum RentFrequency {
  MONTHLY = 'monthly',
  QUARTERLY = 'quarterly',
  BI_ANNUALLY = 'bi-annually',
  ANNUALLY = 'annually',
  CUSTOM = 'custom',
}
