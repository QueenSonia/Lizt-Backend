# Authentication Implementation Guide

## Overview

This authentication system implements a secure access/refresh token pattern with proper expiration times and security measures.

## Key Features

### ✅ Security Improvements Implemented

| Feature                        | Implementation                      | Benefit                                        |
| ------------------------------ | ----------------------------------- | ---------------------------------------------- |
| **Access Token (15 min)**      | Short-lived JWT for API requests    | Minimizes exposure window if compromised       |
| **Refresh Token (7 days)**     | Long-lived token stored in DB       | Allows token revocation and session management |
| **Token Expiration Alignment** | Both cookie and JWT expire together | No more mismatches                             |
| **Rate Limiting**              | 5 attempts per 15 minutes           | Prevents brute force attacks                   |
| **Token Revocation**           | Database-backed refresh tokens      | Can invalidate sessions server-side            |
| **Secure Cookies**             | httpOnly, secure, sameSite          | Prevents XSS and CSRF attacks                  |

## Architecture

### Token Flow

```
┌─────────────┐
│   Client    │
└──────┬──────┘
       │ 1. Login (email/phone + password)
       ▼
┌─────────────────────────────────────┐
│         Login Endpoint              │
│  - Validate credentials             │
│  - Check rate limit (5/15min)       │
│  - Generate access token (15min)    │
│  - Generate refresh token (7 days)  │
│  - Store refresh token in DB        │
└──────┬──────────────────────────────┘
       │ 2. Set cookies
       ▼
┌─────────────────────────────────────┐
│  access_token: JWT (15 min)         │
│  refresh_token: UUID (7 days)       │
└──────┬──────────────────────────────┘
       │ 3. Make API requests
       ▼
┌─────────────────────────────────────┐
│    Protected Endpoints              │
│  - Validate access token            │
│  - Extract user from JWT            │
└──────┬──────────────────────────────┘
       │ 4. Access token expires
       ▼
┌─────────────────────────────────────┐
│    Refresh Endpoint                 │
│  - Validate refresh token from DB   │
│  - Check not revoked                │
│  - Check not expired                │
│  - Generate new access token        │
└─────────────────────────────────────┘
```

## API Endpoints

### 1. Login

```http
POST /users/login
Content-Type: application/json

{
  "identifier": "user@example.com",  // or phone number
  "password": "securePassword123"
}
```

**Response:**

```json
{
  "user": {
    "id": "uuid",
    "first_name": "John",
    "last_name": "Doe",
    "email": "user@example.com",
    "role": "LANDLORD",
    "is_verified": true
  }
}
```

**Cookies Set:**

- `access_token` (15 minutes, httpOnly, secure)
- `refresh_token` (7 days, httpOnly, secure, path=/auth/refresh)

### 2. Refresh Token

```http
POST /auth/refresh
Cookie: refresh_token=<token>
```

**Response:**

```json
{
  "message": "Token refreshed successfully"
}
```

**Cookies Updated:**

- `access_token` (new 15-minute token)

### 3. Logout

```http
POST /users/logout
Cookie: access_token=<token>; refresh_token=<token>
```

**Response:**

```json
{
  "message": "Logout successful"
}
```

**Actions:**

- Revokes refresh token in database
- Clears all auth cookies

### 4. Revoke Token

```http
POST /auth/revoke
Cookie: refresh_token=<token>
```

**Response:**

```json
{
  "message": "Token revoked successfully"
}
```

## Database Schema

### refresh_tokens Table

```sql
CREATE TABLE refresh_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL,
  token TEXT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  is_revoked BOOLEAN DEFAULT FALSE,
  user_agent VARCHAR,
  ip_address VARCHAR
);

CREATE INDEX IDX_REFRESH_TOKEN_ACCOUNT_ID ON refresh_tokens(account_id);
CREATE INDEX IDX_REFRESH_TOKEN_TOKEN ON refresh_tokens(token);
```

## Security Features

### 1. Rate Limiting

- **Limit:** 5 failed login attempts per identifier
- **Window:** 15 minutes
- **Storage:** Redis cache
- **Reset:** On successful login

### 2. Cookie Security

```typescript
{
  httpOnly: true,        // Prevents JavaScript access
  secure: true,          // HTTPS only in production
  sameSite: 'lax',       // CSRF protection
  maxAge: 900000         // 15 minutes for access token
}
```

### 3. Token Revocation

- All refresh tokens stored in database
- Can revoke individual tokens
- Can revoke all user tokens
- Automatic cleanup of expired tokens

### 4. Password Security

- Bcrypt hashing
- Salted passwords
- No password in JWT payload

## Environment Variables

```env
# JWT Configuration
JWT_SECRET=your-super-secret-key-min-32-chars
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d

# Node Environment
NODE_ENV=production
```

## Client Implementation

### Frontend Token Refresh Strategy

```typescript
// Axios interceptor example
axios.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // If 401 and haven't retried yet
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        // Call refresh endpoint
        await axios.post('/auth/refresh', {}, { withCredentials: true });

        // Retry original request
        return axios(originalRequest);
      } catch (refreshError) {
        // Refresh failed, redirect to login
        window.location.href = '/login';
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  },
);
```

### Automatic Token Refresh

```typescript
// Refresh token 1 minute before expiry
setInterval(
  async () => {
    try {
      await fetch('/auth/refresh', {
        method: 'POST',
        credentials: 'include',
      });
    } catch (error) {
      console.error('Token refresh failed:', error);
    }
  },
  14 * 60 * 1000,
); // Every 14 minutes
```

## Migration Guide

### From Old System to New System

1. **Run Migration:**

```bash
npm run migration:run
```

2. **Update Environment Variables:**

```env
# Remove
JWT_EXPIRY=365d

# Add
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d
```

3. **Update Frontend:**

- Implement token refresh interceptor
- Handle 401 responses
- Add automatic refresh timer

4. **Test:**

- Login flow
- Token refresh
- Logout
- Rate limiting

## Monitoring & Maintenance

### Cleanup Expired Tokens

```typescript
// Run daily via cron job
await authService.cleanupExpiredTokens();
```

### Monitor Failed Login Attempts

```typescript
// Check rate limit store
const attempts = await cache.get(`login_attempts:${identifier}`);
```

### Revoke All User Sessions

```typescript
// On password change or security breach
await authService.revokeAllUserTokens(accountId);
```

## Testing

### Test Login Rate Limiting

```bash
# Should succeed
curl -X POST http://localhost:3000/users/login \
  -H "Content-Type: application/json" \
  -d '{"identifier":"test@example.com","password":"wrong"}'

# After 5 attempts, should return 429
```

### Test Token Refresh

```bash
# Login first
curl -X POST http://localhost:3000/users/login \
  -H "Content-Type: application/json" \
  -d '{"identifier":"test@example.com","password":"correct"}' \
  -c cookies.txt

# Wait 16 minutes, then refresh
curl -X POST http://localhost:3000/auth/refresh \
  -b cookies.txt
```

## Troubleshooting

### Issue: "Refresh token not found"

- **Cause:** Cookie not being sent
- **Solution:** Ensure `withCredentials: true` in frontend requests

### Issue: "Too many login attempts"

- **Cause:** Rate limit exceeded
- **Solution:** Wait 15 minutes or clear cache manually

### Issue: "Invalid or expired refresh token"

- **Cause:** Token expired or revoked
- **Solution:** User must login again

## Best Practices

1. **Always use HTTPS in production**
2. **Rotate JWT_SECRET regularly**
3. **Monitor failed login attempts**
4. **Clean up expired tokens daily**
5. **Implement logout on all devices feature**
6. **Log security events**
7. **Use secure password requirements**
8. **Implement 2FA for sensitive accounts**

## Future Enhancements

- [ ] Add 2FA support
- [ ] Implement device fingerprinting
- [ ] Add session management UI
- [ ] Implement "Remember Me" feature
- [ ] Add OAuth2 support
- [ ] Implement IP-based restrictions
- [ ] Add anomaly detection
