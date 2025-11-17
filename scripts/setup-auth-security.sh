#!/bin/bash

# Authentication Security Setup Script
# This script helps set up the new authentication system

echo "🔐 Authentication Security Setup"
echo "================================"
echo ""

# Check if .env file exists
if [ ! -f .env ]; then
    echo "❌ Error: .env file not found"
    echo "Please create a .env file based on .env.example"
    exit 1
fi

# Check for required environment variables
echo "📋 Checking environment variables..."

if ! grep -q "JWT_SECRET=" .env; then
    echo "❌ JWT_SECRET not found in .env"
    exit 1
fi

if ! grep -q "JWT_ACCESS_EXPIRY=" .env; then
    echo "⚠️  JWT_ACCESS_EXPIRY not found, adding default (15m)..."
    echo "JWT_ACCESS_EXPIRY=15m" >> .env
fi

if ! grep -q "JWT_REFRESH_EXPIRY=" .env; then
    echo "⚠️  JWT_REFRESH_EXPIRY not found, adding default (7d)..."
    echo "JWT_REFRESH_EXPIRY=7d" >> .env
fi

echo "✅ Environment variables configured"
echo ""

# Run database migration
echo "🗄️  Running database migration..."
npm run migration:run

if [ $? -eq 0 ]; then
    echo "✅ Database migration completed"
else
    echo "❌ Database migration failed"
    exit 1
fi

echo ""
echo "🎉 Setup complete!"
echo ""
echo "Next steps:"
echo "1. Update your frontend to implement token refresh"
echo "2. Test the login flow"
echo "3. Test the token refresh endpoint"
echo "4. Review AUTH_IMPLEMENTATION_GUIDE.md for details"
echo ""
echo "New endpoints available:"
echo "  POST /auth/refresh - Refresh access token"
echo "  POST /auth/revoke  - Revoke refresh token"
echo ""
echo "Security improvements:"
echo "  ✅ Access tokens: 15 minutes (was 365 days)"
echo "  ✅ Refresh tokens: 7 days with revocation"
echo "  ✅ Rate limiting: 5 attempts per 15 minutes"
echo "  ✅ Secure cookies with proper expiration"
echo ""
