/**
 * Result types for maintenance operations
 * Used by PropertyMaintenanceService for fix, cleanup, and diagnostic methods
 */

export interface FixDetails {
  affectedRecords: string[];
  operationType: string;
  timestamp: Date;
}

export interface FixResult {
  message: string;
  fixed: boolean;
  details: FixDetails | null;
}

export interface CheckDetails {
  checkedRecords: number;
  issuesFound: number;
  lastChecked: Date;
}

export interface CheckResult {
  message: string;
  isFixed: boolean;
  details: CheckDetails | null;
}

export interface DiagnosticIssue {
  type: string;
  description: string;
  affectedRecords: number;
  recommendation: string;
}

export interface DiagnosticResult {
  message: string;
  issues: DiagnosticIssue[];
}

export interface CleanupResult {
  message: string;
  success: boolean;
  removedCount: number;
}

export type ConsistencyIssueType =
  | 'orphaned'
  | 'duplicate'
  | 'status_mismatch'
  | 'date_inconsistency';

export interface ConsistencyIssue {
  rentId: string;
  propertyId: string;
  tenantId: string;
  issueType: ConsistencyIssueType;
  description: string;
}

export interface ConsistencyResult {
  message: string;
  issues: ConsistencyIssue[];
  fixedCount: number;
}
