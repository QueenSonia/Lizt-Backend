# KYC OTP Verification Endpoints

This document describes the OTP (One-Time Password) verification endpoints for the KYC system.

## Endpoints

### 1. Send OTP

**POST** `/api/kyc/:token/send-otp`

Sends a 6-digit OTP to the specified phone number for KYC verification.

#### Request Body

```json
{
  "phoneNumber": "+2348123456789"
}
```

#### Response

```json
{
  "success": true,
  "message": "OTP sent successfully to your phone number",
  "expiresAt": "2024-11-04T15:30:00.000Z"
}
```

#### Error Response

```json
{
  "success": false,
  "message": "Invalid phone number format"
}
```

### 2. Verify OTP

**POST** `/api/kyc/:token/verify-otp`

Verifies the OTP code sent to the phone number.

#### Request Body

```json
{
  "phoneNumber": "+2348123456789",
  "otpCode": "123456"
}
```

#### Response

```json
{
  "success": true,
  "message": "Phone number verified successfully",
  "verified": true
}
```

#### Error Response

```json
{
  "success": false,
  "message": "Invalid OTP code"
}
```

## Features

### Security Features

- **Rate Limiting**: Prevents spam by limiting OTP requests per phone number
- **Expiry**: OTPs expire after 10 minutes
- **Single Use**: Each OTP can only be used once
- **Token Validation**: Validates KYC token before sending/verifying OTP

### Error Handling

- Invalid phone number format validation
- Expired OTP detection
- Rate limiting protection
- Network error handling with retry logic

### WhatsApp Integration

- OTPs are sent via WhatsApp using the existing WhatsApp bot service
- Fallback handling if WhatsApp delivery fails
- Professional message formatting

## Usage Flow

1. **Send OTP**: Call `/send-otp` with phone number
2. **User receives OTP**: 6-digit code sent via WhatsApp
3. **Verify OTP**: Call `/verify-otp` with phone number and OTP code
4. **Success**: Phone number is verified for the KYC application

## Database Schema

The OTP system uses a dedicated `kyc_otp` table:

```sql
CREATE TABLE kyc_otp (
  id UUID PRIMARY KEY,
  phone_number VARCHAR NOT NULL,
  otp_code VARCHAR(6) NOT NULL,
  kyc_token VARCHAR NOT NULL,
  is_verified BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

## Frontend Integration

The frontend KYC form automatically integrates with these endpoints through:

- `KYCOTPService` for API calls
- `OTPVerificationStep` component for UI
- Automatic retry logic and error handling
- Real-time validation and feedback

## Testing

To test the OTP endpoints:

1. Use a valid KYC token from `/api/kyc/:token/validate`
2. Send OTP to a valid Nigerian phone number
3. Check WhatsApp for the OTP code
4. Verify the OTP within 10 minutes

## Error Codes

- `400`: Invalid request (bad phone number, expired token, etc.)
- `429`: Rate limited (too many requests)
- `500`: Server error (WhatsApp service issues, database errors)
