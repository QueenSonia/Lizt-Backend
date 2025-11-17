# Authentication Quick Reference

## Token Lifetimes

- **Access Token:** 15 minutes
- **Refresh Token:** 7 days
- **Rate Limit:** 5 attempts per 15 minutes

## Endpoints

### Login

```http
POST /users/login
{
  "identifier": "user@example.com",  // or phone
  "password": "password"
}
```

**Returns:** User object + sets cookies (access_token, refresh_token)

### Refresh Token

```http
POST /auth/refresh
Cookie: refresh_token=<token>
```

**Returns:** New access_token cookie

### Logout

```http
POST /users/logout
Cookie: access_token=<token>; refresh_token=<token>
```

**Returns:** Success message + clears cookies

### Revoke Token

```http
POST /auth/revoke
Cookie: refresh_token=<token>
```

**Returns:** Success message + clears cookies

## Frontend Integration

### Axios Interceptor

```typescript
axios.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401 && !error.config._retry) {
      error.config._retry = true;
      await axios.post('/auth/refresh', {}, { withCredentials: true });
      return axios(error.config);
    }
    return Promise.reject(error);
  },
);
```

### Auto Refresh (Every 14 minutes)

```typescript
setInterval(
  async () => {
    await fetch('/auth/refresh', {
      method: 'POST',
      credentials: 'include',
    });
  },
  14 * 60 * 1000,
);
```

## Cookie Settings

### Access Token

```typescript
{
  httpOnly: true,
  secure: true,           // production only
  maxAge: 900000,         // 15 minutes
  sameSite: 'lax'
}
```

### Refresh Token

```typescript
{
  httpOnly: true,
  secure: true,           // production only
  maxAge: 604800000,      // 7 days
  sameSite: 'lax',
  path: '/auth/refresh'
}
```

## Environment Variables

```env
JWT_SECRET=your-secret-key-min-32-chars
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d
NODE_ENV=production
```

## Common Tasks

### Revoke All User Sessions

```typescript
await authService.revokeAllUserTokens(accountId);
```

### Clean Up Expired Tokens

```typescript
await authService.cleanupExpiredTokens();
```

### Check Rate Limit

```typescript
const attempts = await cache.get(`login_attempts:${identifier}`);
```

## Error Codes

- **401:** Unauthorized (invalid/expired token)
- **429:** Too Many Requests (rate limit exceeded)
- **404:** User not found
- **400:** Invalid credentials format

## Security Checklist

- [x] HTTPS in production
- [x] httpOnly cookies
- [x] Short-lived access tokens
- [x] Rate limiting enabled
- [x] Token revocation support
- [x] Secure cookie settings
- [ ] 2FA (future enhancement)

## Testing

### Test Login

```bash
curl -X POST http://localhost:3000/users/login \
  -H "Content-Type: application/json" \
  -d '{"identifier":"test@example.com","password":"password"}' \
  -c cookies.txt
```

### Test Refresh

```bash
curl -X POST http://localhost:3000/auth/refresh \
  -b cookies.txt
```

### Test Rate Limit

```bash
# Run 6 times with wrong password
for i in {1..6}; do
  curl -X POST http://localhost:3000/users/login \
    -H "Content-Type: application/json" \
    -d '{"identifier":"test@example.com","password":"wrong"}'
done
```

## Troubleshooting

| Issue                              | Solution                                   |
| ---------------------------------- | ------------------------------------------ |
| "Refresh token not found"          | Ensure `withCredentials: true` in requests |
| "Too many login attempts"          | Wait 15 minutes or clear cache             |
| "Invalid or expired refresh token" | User must login again                      |
| Cookies not being set              | Check CORS settings and credentials        |

## Migration Checklist

- [ ] Run database migration
- [ ] Update .env variables
- [ ] Update frontend interceptor
- [ ] Test login flow
- [ ] Test token refresh
- [ ] Test rate limiting
- [ ] Deploy to staging
- [ ] Monitor logs
- [ ] Deploy to production

## Support

See [AUTH_IMPLEMENTATION_GUIDE.md](./AUTH_IMPLEMENTATION_GUIDE.md) for detailed documentation.
