// interface for nested objects
interface PaymentHistoryItem {
  id: string;
  amount: number;
  date: string;
  status: string;
  reference: string | null;
}

interface DocumentItem {
  id: string;
  name: string;
  url: string;
  type?: string;
  uploadDate: string;
}

interface PastTenancyItem {
  id: string;
  property: string;
  propertyId?: string; // For active tenancies
  rentAmount?: number; // For active tenancies
  serviceCharge?: number; // For active tenancies
  rentFrequency?: string; // For active tenancies
  rentDueDate?: string | null; // For active tenancies
  tenancyStartDate?: string | null; // For active tenancies
  startDate?: string; // For past tenancies
  endDate?: string | null; // For past tenancies
  status: 'Active' | 'Completed';
}

interface MaintenanceIssue {
  id: string;
  title: string;
  description: string;
  status: string;
  reportedDate: string;
  resolvedDate: string | null;
  priority: 'High' | 'Medium' | 'Low';
}

interface TimeLineEvent {
  id: string;
  type: 'payment' | 'maintenance' | 'notice' | 'general';
  date: string;
  description: string;
  time: string;
  title: string;
}

interface KycInfo {
  kycStatus: 'Verified' | 'Pending' | 'Rejected' | 'Not Submitted';
  kycSubmittedDate: string | null;
  kycDocuments?: DocumentItem[];
}

// main DTO interface
export class TenantDetailDto {
  id: string; // Account ID

  // Personal Information
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  dateOfBirth: string | null;
  gender: string | null;
  stateOfOrigin: string | null;
  lga: string | null;
  nationality: string | null;
  maritalStatus: string | null;
  religion: string | null;

  // Employment Information
  employmentStatus: string | null;
  employerName: string | null;
  employerAddress: string | null;
  jobTitle: string | null;
  workEmail: string | null;
  monthlyIncome: number | null;
  employerPhoneNumber: string | null;
  lengthOfEmployment: string | null;

  // Residence information (from KYC)
  currentAddress: string | null;

  // Next of Kin Information (from KYC reference1)
  nokName: string | null;
  nokRelationship: string | null;
  nokPhone: string | null;
  nokEmail: string | null;
  nokAddress: string | null;

  // Guarantor Information (from KYC reference2)
  guarantorName: string | null;
  guarantorPhone: string | null;
  guarantorEmail: string | null;
  guarantorAddress: string | null;
  guarantorRelationship: string | null;
  guarantorOccupation: string | null;

  // TenantKyc ID for updates
  tenantKycId: string | null;

  // Passport Photo URL (from KYC Application)
  passportPhotoUrl: string | null;

  // Tenancy Proposal Information (from KYC Application)
  intendedUseOfProperty: string | null;
  numberOfOccupants: string | null;
  numberOfCarsOwned: string | null;
  proposedRentAmount: string | null;
  rentPaymentFrequency: string | null;
  additionalNotes: string | null;

  // Current Tenancy (from Rent/Property)
  property: string;
  propertyId: string;
  propertyAddress: string;
  propertyStatus: string;

  // System Info
  whatsAppConnected: boolean; // Placeholder logic

  // Tenancy Details
  leaseStartDate: string | null;
  leaseEndDate: string | null;
  tenancyStatus: string;

  // Rent Information
  rentAmount: number;
  serviceCharge?: number;
  rentFrequency?: string;
  rentStatus: string;
  nextRentDue: string | null;
  outstandingBalance: number;
  paymentFrequency: string | null; // Actual agreed payment frequency from Rent record

  // Aggregated Data
  documents: DocumentItem[];
  activeTenancies: PastTenancyItem[]; // Active rent records with full property details
  tenancyHistory: PastTenancyItem[]; // Historical tenancy records (past properties)
  paymentHistory: PaymentHistoryItem[];
  maintenanceIssues: MaintenanceIssue[];
  history: TimeLineEvent[];
  kycInfo: KycInfo;
}
