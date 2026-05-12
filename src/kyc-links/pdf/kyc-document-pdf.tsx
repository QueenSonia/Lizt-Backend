/**
 * Backend port of `lizt-frontend/src/components/pdf/KYCDocumentPDF.tsx`.
 * Mirrors the layout verbatim so the WhatsApp-delivered PDF matches the
 * one a landlord gets by clicking Download PDF on the web detail page.
 *
 * Differences from the frontend version:
 *  - `IKycApplication` is inlined here (no `@/types` alias on backend).
 *  - `React` import is explicit (classic JSX runtime via tsconfig "jsx": "react").
 * Keep this file in sync with the frontend component when fields change.
 */

import React from 'react';
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Image,
  Link,
  Svg,
  Path,
  G,
} from '@react-pdf/renderer';

export interface IKycApplication {
  id: string;
  propertyId: string;
  tenantId?: string;
  name: string;
  email: string;
  phone: string;
  occupation: string;
  idType: string;
  submittedDate: string;

  // Personal Details
  surname?: string;
  otherNames?: string;
  contactAddress?: string;
  nationality?: string;
  stateOfOrigin?: string;
  sex?: string;
  dateOfBirth?: string;
  passportPhoto?: string;
  religion?: string;

  // Professional
  profession?: string;
  positionInWorkplace?: string;
  jobTitle?: string;
  placeOfWork?: string;

  // Marital Status
  maritalStatus?: string;

  // Employment Details
  employmentStatus?: string;
  levelOfEducation?: string;
  employerName?: string;
  workPhone?: string;
  monthlyIncome?: string;
  officeAddress?: string;
  yearsAtEmployer?: string;

  // Self-employed specific fields
  natureOfBusiness?: string;
  businessName?: string;
  businessAddress?: string;
  businessDuration?: string;

  // Next of Kin
  nextOfKin?: {
    fullName: string;
    address: string;
    relationship: string;
    phone: string;
    email: string;
  };

  // Tenancy Information
  tenantOffer?: {
    proposedRentAmount: number;
    rentPaymentFrequency: 'Monthly' | 'Quarterly' | 'Bi-annually' | 'Annually';
    intendedUse?: string;
    numberOfOccupants?: string;
    numberOfCarsOwned?: string;
    additionalNotes?: string;
  };

  // Referral Agent
  referralAgent?: {
    fullName: string;
    phoneNumber: string;
  };

  documents?: Array<{
    name: string;
    url: string;
  }>;
}

const styles = StyleSheet.create({
  page: {
    padding: '42.5pt 56.7pt',
    fontFamily: 'Helvetica',
    backgroundColor: '#ffffff',
  },
  header: {
    marginBottom: 12,
  },
  logo: {
    width: 60,
    height: 26,
    marginBottom: 20,
  },
  headerContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  titleBlock: {
    flex: 1,
  },
  title: {
    fontSize: 18,
    fontWeight: 'normal',
    color: '#0a0a0a',
    marginBottom: 4,
  },
  metadata: {
    fontSize: 11,
    color: '#6b7280',
    flexDirection: 'row',
    alignItems: 'center',
  },
  metadataDivider: {
    marginHorizontal: 8,
    color: '#d1d5db',
  },
  section: {
    marginBottom: 24,
  },
  sectionHeadingRow: {
    flexDirection: 'row',
    borderBottomWidth: 0.25,
    borderBottomColor: '#ea580c',
    paddingBottom: 4,
    marginBottom: 14,
    marginTop: 6,
  },
  sectionNumber: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#ea580c',
    marginRight: 6,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'normal',
    color: '#1f2937',
  },
  subsection: {
    marginBottom: 16,
  },
  subsectionTitle: {
    fontSize: 11,
    fontWeight: 'normal',
    color: '#374151',
    textTransform: 'uppercase',
    letterSpacing: 0.05,
    marginBottom: 8,
  },
  fieldGrid: {
    flexDirection: 'column',
  },
  fieldRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  field: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  fieldLabel: {
    width: 200,
    fontSize: 9.5,
    color: '#9ca3af',
    textTransform: 'uppercase',
    letterSpacing: 0.05,
  },
  fieldValue: {
    flex: 1,
    fontSize: 12,
    fontWeight: 'normal',
    color: '#1f2937',
  },
  divider: {
    borderTopWidth: 0.25,
    borderTopColor: '#e5e7eb',
    paddingTop: 20,
    marginTop: 20,
  },
  documentItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 0.25,
    borderColor: '#e5e7eb',
    padding: '8pt 10pt',
    marginBottom: 6,
  },
  documentInfo: {
    flex: 1,
  },
  documentName: {
    fontSize: 12,
    color: '#374151',
  },
  documentType: {
    fontSize: 11,
    color: '#6b7280',
    marginTop: 2,
  },
  documentStatus: {
    alignItems: 'flex-end',
  },
  declarationBox: {
    borderWidth: 0.25,
    borderColor: '#e5e7eb',
    padding: '12pt 14pt',
    backgroundColor: '#fafafa',
    marginBottom: 14,
  },
  declarationText: {
    fontSize: 11,
    color: '#374151',
    lineHeight: 1.5,
    marginBottom: 6,
  },
  bulletPoint: {
    flexDirection: 'row',
    marginBottom: 5,
  },
  bullet: {
    width: 10,
    fontSize: 11,
    color: '#374151',
  },
  bulletContent: {
    flex: 1,
    fontSize: 11,
    color: '#374151',
    lineHeight: 1.5,
  },
  footer: {
    borderTopWidth: 0.25,
    borderTopColor: '#e5e7eb',
    paddingTop: 10,
    marginTop: 28,
  },
  footerContact: {
    textAlign: 'center',
    fontSize: 10,
    color: '#9ca3af',
    marginTop: 10,
  },
});

const Logo = () => (
  <View style={styles.logo}>
    <Svg width="60" height="26" viewBox="0 0 80.8194 35.9455">
      <G>
        <Path
          d="M20.7845 4.40621C21.6869 4.40621 22.5516 4.76864 23.1843 5.41207L29.2942 11.6256C29.9132 12.255 30.2601 13.1025 30.2601 13.9854V24.4151C30.2601 26.2739 28.7532 27.7807 26.8944 27.7807H24.2434L26.1611 25.4805C26.3438 25.2613 26.188 24.9285 25.9027 24.9284L21.6379 24.9267C21.2662 24.9265 20.965 24.6252 20.965 24.2535V13.8658C20.965 12.722 20.48 11.6318 19.6305 10.866L16.0592 7.64668C15.8427 7.45149 15.4973 7.60513 15.4973 7.89667V24.0043C15.4973 25.0146 16.001 25.9584 16.8403 26.5208C16.8955 26.5578 16.9012 26.6369 16.8518 26.6814L15.6319 27.7807H9.70441C7.84561 27.7807 6.33876 26.2739 6.33876 24.4151V13.9854C6.33876 13.1025 6.68565 12.255 7.30461 11.6256L13.4145 5.41207C14.0473 4.76864 14.9119 4.40621 15.8143 4.40621H20.7845Z"
          fill="#FE5001"
        />
        <Path
          d="M71.6486 26.2194C70.0087 26.2194 68.7881 25.8571 67.9872 25.1324C67.2053 24.4078 66.8145 23.2731 66.8145 21.7285V14.4914V11.4307V7.14005H70.3043V11.4307H74.4234V14.4914H70.3043V21.2708C70.3043 21.9382 70.4663 22.415 70.7906 22.701C71.1149 22.968 71.6486 23.1015 72.3923 23.1015C73.117 23.1015 73.8131 23.0252 74.4806 22.8727V25.8189C73.6032 26.0859 72.6594 26.2194 71.6486 26.2194Z"
          fill="black"
        />
        <Path
          d="M64.6961 22.9871V25.9906H52.7394V23.5592L60.2052 14.4343H52.9682V11.4308H64.6103V13.8622L57.1444 22.9871H64.6961Z"
          fill="black"
        />
        <Path
          d="M48.4661 8.99944C47.7986 8.99944 47.2552 8.79922 46.8358 8.39876C46.4354 7.9792 46.2352 7.45479 46.2352 6.82547C46.2352 6.19619 46.4354 5.68128 46.8358 5.28082C47.2552 4.8613 47.7986 4.65154 48.4661 4.65154C49.1147 4.65154 49.6388 4.8613 50.0396 5.28082C50.459 5.68128 50.6688 6.19619 50.6688 6.82547C50.6688 7.45479 50.459 7.9792 50.0396 8.39876C49.6388 8.79922 49.1147 8.99944 48.4661 8.99944ZM46.7214 11.4309H50.2112V25.9906H46.7214V11.4309Z"
          fill="black"
        />
        <Path
          d="M43.9269 22.6152V25.9906H38.842C37.3972 25.9906 36.2259 24.8193 36.2259 23.3746V5.96728H39.8589V21.9612C39.8589 22.3224 40.1515 22.6152 40.5129 22.6152H43.9269Z"
          fill="black"
        />
      </G>
    </Svg>
  </View>
);

const Field = ({
  label,
  value,
}: {
  label: string;
  value: string | number | undefined | null;
}) => (
  <View style={styles.fieldRow}>
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue}>{value || '——'}</Text>
    </View>
  </View>
);

const SectionHeading = ({
  number,
  title,
}: {
  number: string;
  title: string;
}) => (
  <View style={styles.sectionHeadingRow}>
    <Text style={styles.sectionNumber}>{number}.</Text>
    <Text style={styles.sectionTitle}>{title}</Text>
  </View>
);

interface KYCDocumentPDFProps {
  application: IKycApplication;
  propertyName: string;
}

export const KYCDocumentPDF = ({
  application,
  propertyName,
}: KYCDocumentPDFProps) => {
  const formatDate = (dateString?: string) => {
    if (!dateString) return '——';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return '——';
    return date.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const fullName = (application.name || '').trim();
  const nameParts = fullName.split(' ');
  const firstName = application.otherNames || nameParts[0] || '——';
  const surname = application.surname || nameParts.slice(1).join(' ') || '——';

  const submittedDate = application.submittedDate
    ? formatDate(application.submittedDate)
    : formatDate(new Date().toISOString());

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Logo />
          <View style={styles.headerContent}>
            <View style={styles.titleBlock}>
              <Text style={styles.title}>Tenant KYC Application</Text>
              <View style={styles.metadata}>
                <Text>{submittedDate}</Text>
                <Text style={styles.metadataDivider}>•</Text>
                <Text>{propertyName}</Text>
              </View>
            </View>
          </View>
        </View>

        <View>
          <SectionHeading number="1" title="Personal Details" />
        </View>

        <View style={styles.subsection}>
          <Text style={styles.subsectionTitle}>Personal Information</Text>

          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
            }}
          >
            <View style={{ flex: 1, marginRight: 40 }}>
              <Field label="First Name" value={firstName} />
              <Field label="Surname" value={surname} />
              <Field label="Sex" value={application.sex} />
              <Field
                label="Date of Birth"
                value={formatDate(application.dateOfBirth)}
              />
              <Field label="Marital Status" value={application.maritalStatus} />
              <Field label="Religion" value={application.religion} />
            </View>

            {application.passportPhoto && (
              <View
                style={{
                  alignSelf: 'flex-start',
                  marginTop: -20,
                  marginLeft: 40,
                }}
              >
                <Image
                  src={application.passportPhoto}
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: 8,
                    borderWidth: 1,
                    borderColor: '#d1d5db',
                  }}
                />
              </View>
            )}
          </View>
        </View>

        <View style={styles.subsection}>
          <Text style={styles.subsectionTitle}>Contact Information</Text>
          <View style={styles.fieldGrid}>
            <Field label="Phone Number (WhatsApp)" value={application.phone} />
            <Field label="Email Address" value={application.email} />
            <Field label="Contact Address" value={application.contactAddress} />
            <Field label="Nationality" value={application.nationality} />
            <Field label="State of Origin" value={application.stateOfOrigin} />
          </View>
        </View>

        <View style={styles.subsection}>
          <Text style={styles.subsectionTitle}>Next of Kin Details</Text>
          <View style={styles.fieldGrid}>
            <Field label="Full Name" value={application.nextOfKin?.fullName} />
            <Field
              label="Relationship"
              value={application.nextOfKin?.relationship}
            />
            <Field label="Phone Number" value={application.nextOfKin?.phone} />
            <Field
              label="Email Address"
              value={application.nextOfKin?.email}
            />
            <Field label="Address" value={application.nextOfKin?.address} />
          </View>
        </View>

        <View style={styles.section}>
          <SectionHeading number="2" title="Employment Details" />
          <View style={styles.subsection}>
            <Field
              label="Employment Status"
              value={application.employmentStatus}
            />
          </View>

          <View style={styles.subsection}>
            <Text style={styles.subsectionTitle}>Employment Information</Text>
            <View style={styles.fieldGrid}>
              {application.employmentStatus?.toLowerCase() === 'employed' ? (
                <>
                  <Field
                    label="Occupation"
                    value={application.occupation}
                  />
                  <Field
                    label="Employer Name"
                    value={application.employerName || application.placeOfWork}
                  />
                  <Field
                    label="Job Title"
                    value={
                      application.jobTitle ||
                      application.profession ||
                      application.occupation
                    }
                  />
                  <Field
                    label="Work Phone Number"
                    value={application.workPhone}
                  />
                  <Field
                    label="Monthly Income"
                    value={
                      application.monthlyIncome
                        ? `NGN ${parseFloat(
                            application.monthlyIncome.replace(/,/g, ''),
                          ).toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                          })}`
                        : '——'
                    }
                  />
                  <Field
                    label="Length of Employment"
                    value={application.yearsAtEmployer}
                  />
                  <Field
                    label="Work Address"
                    value={
                      application.officeAddress || application.businessAddress
                    }
                  />
                </>
              ) : application.employmentStatus?.toLowerCase() ===
                'self-employed' ? (
                <>
                  <Field
                    label="Business Name"
                    value={application.businessName}
                  />
                  <Field
                    label="Nature of Business"
                    value={
                      application.natureOfBusiness || application.occupation
                    }
                  />
                  <Field
                    label="Business Duration"
                    value={application.businessDuration}
                  />
                  <Field
                    label="Monthly Income"
                    value={
                      application.monthlyIncome
                        ? `NGN ${parseFloat(
                            application.monthlyIncome.replace(/,/g, ''),
                          ).toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                          })}`
                        : '——'
                    }
                  />
                  <Field
                    label="Business Address"
                    value={application.businessAddress}
                  />
                </>
              ) : (
                <>
                  <Field
                    label="Occupation"
                    value={application.occupation || application.profession}
                  />
                  <Field
                    label="Monthly Income"
                    value={
                      application.monthlyIncome
                        ? `NGN ${parseFloat(
                            application.monthlyIncome.replace(/,/g, ''),
                          ).toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                          })}`
                        : '——'
                    }
                  />
                </>
              )}
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <SectionHeading number="3" title="Tenancy Information" />
          <View style={styles.subsection}>
            <Text style={styles.subsectionTitle}>Property Usage</Text>
            <View style={styles.fieldGrid}>
              <Field
                label="Intended Use of Property"
                value={application.tenantOffer?.intendedUse}
              />
              <Field
                label="Number of Occupants"
                value={application.tenantOffer?.numberOfOccupants}
              />
              <Field
                label="Number of Cars Owned"
                value={application.tenantOffer?.numberOfCarsOwned}
              />
            </View>
          </View>

          <View style={styles.subsection}>
            <Text style={styles.subsectionTitle}>Rental Offer</Text>
            <View style={styles.fieldGrid}>
              <Field
                label="Proposed Rent Amount"
                value={
                  application.tenantOffer?.proposedRentAmount
                    ? `NGN ${Number(
                        application.tenantOffer.proposedRentAmount,
                      ).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                      })}`
                    : '——'
                }
              />
              <Field
                label="Rent Payment Frequency"
                value={application.tenantOffer?.rentPaymentFrequency}
              />
            </View>
          </View>

          {application.tenantOffer?.additionalNotes && (
            <View style={styles.divider}>
              <Text style={styles.subsectionTitle}>Additional Notes</Text>
              <Text
                style={{
                  fontSize: 13,
                  color: '#0a0a0a',
                  lineHeight: 1.5,
                  fontWeight: 'normal',
                }}
              >
                {application.tenantOffer.additionalNotes}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.section}>
          <SectionHeading number="4" title="Referral Agent" />
          <View style={styles.subsection}>
            <View style={styles.fieldGrid}>
              <Field
                label="Full Name"
                value={application.referralAgent?.fullName}
              />
              <Field
                label="Phone Number"
                value={application.referralAgent?.phoneNumber}
              />
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <SectionHeading number="5" title="Identification & Declaration" />
          <View style={styles.subsection}>
            <Text style={styles.subsectionTitle}>Document Uploads</Text>
            <View style={styles.fieldGrid}>
              {application.documents &&
              application.documents.filter(
                (doc) => doc.url && doc.url !== '-' && doc.url !== '——',
              ).length > 0 ? (
                application.documents
                  .filter(
                    (doc) =>
                      doc.url && doc.url !== '-' && doc.url !== '——',
                  )
                  .map((doc, index) => (
                    <View key={index} style={styles.documentItem}>
                      <View style={styles.documentInfo}>
                        <Text style={styles.documentName}>
                          {doc.name
                            .replace(/_/g, ' ')
                            .replace(/\.[^/.]+$/, '')}
                        </Text>
                        <Text style={styles.documentType}>Document</Text>
                      </View>
                      <View style={styles.documentStatus}>
                        <Link
                          src={doc.url}
                          style={{ textDecoration: 'none' }}
                        >
                          <Text style={{ fontSize: 11, color: '#ea580c' }}>
                            View
                          </Text>
                        </Link>
                      </View>
                    </View>
                  ))
              ) : (
                <Text style={{ fontSize: 11, color: '#6b7280' }}>
                  No documents uploaded.
                </Text>
              )}
            </View>
          </View>

          <View style={styles.divider} break>
            <Text style={styles.subsectionTitle}>Declaration</Text>
            <View style={styles.declarationBox}>
              <Text style={styles.declarationText}>
                I hereby declare and confirm that:
              </Text>
              <View style={styles.bulletPoint}>
                <Text style={styles.bullet}>•</Text>
                <Text style={styles.bulletContent}>
                  All information provided in this application is true,
                  accurate, and complete to the best of my knowledge.
                </Text>
              </View>
              <View style={styles.bulletPoint}>
                <Text style={styles.bullet}>•</Text>
                <Text style={styles.bulletContent}>
                  I understand that providing false or misleading information
                  may result in the immediate termination of my tenancy
                  agreement.
                </Text>
              </View>
              <View style={styles.bulletPoint}>
                <Text style={styles.bullet}>•</Text>
                <Text style={styles.bulletContent}>
                  I consent to Lizt conducting background checks, employment
                  verification, and contacting my references as part of the
                  application review process.
                </Text>
              </View>
              <View style={styles.bulletPoint}>
                <Text style={styles.bullet}>•</Text>
                <Text style={styles.bulletContent}>
                  I agree to comply with all tenancy terms and conditions as
                  outlined in the lease agreement.
                </Text>
              </View>
              <View style={styles.bulletPoint}>
                <Text style={styles.bullet}>•</Text>
                <Text style={styles.bulletContent}>
                  I confirm that the intended use of the property is as stated
                  in this application and will not be used for any unlawful
                  purposes.
                </Text>
              </View>
            </View>

            <Field label="Declaration Accepted" value="Yes" />
          </View>
        </View>

        <View style={styles.footer}>
          <Text style={{ fontSize: 8, color: '#6b7280' }}>
            Generated by Lizt
          </Text>
          <Text style={styles.footerContact}>
            For enquiries, contact hello@propertykraft.africa
          </Text>
          <Text
            style={{
              fontSize: 8,
              color: '#6b7280',
              textAlign: 'right',
              marginTop: 5,
            }}
            render={({
              pageNumber,
              totalPages,
            }: {
              pageNumber: number;
              totalPages: number;
            }) => `Page ${pageNumber} of ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  );
};

// Silence the "React imported but not used" warning in some linters — JSX
// classic runtime requires React in scope at runtime even though the
// identifier appears only via JSX.
void React;
