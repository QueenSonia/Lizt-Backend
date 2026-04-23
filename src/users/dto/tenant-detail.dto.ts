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
  images: string[];
}

interface TimeLineEvent {
  id: string;
  type:
    | 'payment'
    | 'maintenance'
    | 'notice'
    | 'general'
    | 'offer_letter'
    | 'invoice'
    | 'receipt';
  date: string;
  description: string;
  time: string;
  title: string;
  details?: string; // Additional details like property name or amount
  offerLetterData?: {
    id: string;
    token: string;
    propertyName: string;
    propertyId: string;
    rentAmount: number;
    rentFrequency: string;
    serviceCharge: number;
    cautionDeposit: number;
    legalFee: number;
    agencyFee: number;
    totalAmount: number;
    tenancyStartDate: Date;
    tenancyEndDate: Date;
    status: string;
    paymentStatus: string;
    amountPaid: number;
    outstandingBalance: number;
    creditBalance: number;
  };
  receiptData?: {
    id: string;
    propertyName: string;
    propertyId?: string;
    amountPaid: number;
    paymentMethod: string | null;
    reference: string;
    paidAt?: string;
    isPartPayment: boolean;
  };
  amount?: string | null;
  relatedEntityId?: string;
  relatedEntityType?: string;
}

interface KycInfo {
  kycStatus: 'Verified' | 'Pending' | 'Rejected' | 'Not Submitted';
  kycSubmittedDate: string | null;
  kycDocuments?: DocumentItem[];
}

interface OutstandingBalanceTransaction {
  id: string;
  type: string;
  amount: number;
  date: Date;
}

interface OutstandingBalanceBreakdown {
  rentId: string;
  propertyName: string;
  propertyId: string;
  outstandingAmount: number;
  tenancyStartDate: Date | null;
  tenancyEndDate: Date | null;
  transactions: OutstandingBalanceTransaction[];
}

interface RenewalInvoiceSummary {
  id: string;
  token: string;
  receiptToken: string | null;
  propertyName: string;
  totalAmount: number;
  paymentStatus: string;
  createdAt: string;
  paidAt: string | null;
  startDate: string | null;
  endDate: string | null;
}

interface AdHocInvoiceSummary {
  id: string;
  invoiceNumber: string;
  publicToken: string;
  receiptToken: string | null;
  propertyName: string;
  totalAmount: number;
  status: string; // 'pending' | 'paid' | 'overdue' | 'cancelled'
  dueDate: string;
  createdAt: string;
  paidAt: string | null;
}

interface PaymentPlanInstallmentSummary {
  id: string;
  sequence: number;
  amount: number;
  dueDate: string;
  status: string; // 'pending' | 'paid'
  paidAt: string | null;
  receiptToken: string | null;
}

interface PaymentPlanSummary {
  id: string;
  propertyTenantId: string;
  propertyId: string;
  propertyName: string;
  chargeName: string;
  scope: string;
  planType: string;
  status: string; // 'active' | 'completed' | 'cancelled'
  totalAmount: number;
  createdAt: string;
  installments: PaymentPlanInstallmentSummary[];
}

interface PaymentPlanRequestSummary {
  id: string;
  propertyTenantId: string;
  propertyId: string;
  propertyName: string;
  totalAmount: number;
  status: string; // 'pending' | 'approved' | 'declined'
  preferredSchedule: string;
  createdAt: string;
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

  // Self-employed Information
  natureOfBusiness: string | null;
  businessName: string | null;
  businessAddress: string | null;
  businessDuration: string | null;
  occupation: string | null;

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

  // Outstanding Balance Info
  totalOutstandingBalance: number;
  totalCreditBalance: number;
  outstandingBalanceBreakdown: OutstandingBalanceBreakdown[];
  paymentTransactions: OutstandingBalanceTransaction[];

  // Tenancy Details
  leaseStartDate: string | null;
  leaseEndDate: string | null;
  firstRentDate: string | null;
  tenancyStatus: string;

  // Rent Information
  rentAmount: number;
  serviceCharge?: number;
  rentFrequency?: string;
  rentStatus: string;
  nextRentDue: string | null;
  pendingInvoiceRentAmount: number | null;
  pendingInvoiceTotalAmount: number | null;
  outstandingBalance: number;
  creditBalance: number;
  paymentFrequency: string | null; // Actual agreed payment frequency from Rent record

  // Aggregated Data
  documents: DocumentItem[];
  activeTenancies: PastTenancyItem[]; // Active rent records with full property details
  tenancyHistory: PastTenancyItem[]; // Historical tenancy records (past properties)
  paymentHistory: PaymentHistoryItem[];
  maintenanceIssues: MaintenanceIssue[];
  history: TimeLineEvent[];
  renewalInvoices: RenewalInvoiceSummary[];
  adHocInvoices: AdHocInvoiceSummary[];
  paymentPlans: PaymentPlanSummary[];
  paymentPlanRequests: PaymentPlanRequestSummary[];
  kycInfo: KycInfo;
}
