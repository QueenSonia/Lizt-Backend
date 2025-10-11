// interface for nested objects
interface PaymentHistoryItem {
  id: string;
  amount: number;
  date: string;
  status: string;
  reference: string | null;
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
}

// main DTO interface
export class TenantDetailDto {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  property: string;
  propertyId: string;
  propertyAddress: string;

  // Tenancy Details
  leaseStartDate: string;
  leaseEndDate: string;

  // Rent Information
  rentAmount: number;
  rentStatus: string;
  nextRentDue: string;
  outstandingBalance: number;

  // Aggregated Data
  paymentHistory: PaymentHistoryItem[];
  maintenanceIssues: MaintenanceIssue[];
  history: TimeLineEvent[];
  kycInfo: KycInfo;
}
