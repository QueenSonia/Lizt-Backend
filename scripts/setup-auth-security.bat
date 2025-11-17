@echo off
REM Authentication Security Setup Script
REM This script helps set up the new authentication system

echo.
echo 🔐 Authentication Security Setup
echo ================================
echo.

REM Check if .env file exists
if not exist .env (
    echo ❌ Error: .env file not found
    echo Please create a .env file based on .env.example
    exit /b 1
)

REM Check for required environment variables
echo 📋 Checking environment variables...

findstr /C:"JWT_SECRET=" .env >nul
if errorlevel 1 (
    echo ❌ JWT_SECRET not found in .env
    exit /b 1
)

findstr /C:"JWT_ACCESS_EXPIRY=" .env >nul
if errorlevel 1 (
    echo ⚠️  JWT_ACCESS_EXPIRY not found, adding default (15m)...
    echo JWT_ACCESS_EXPIRY=15m >> .env
)

findstr /C:"JWT_REFRESH_EXPIRY=" .env >nul
if errorlevel 1 (
    echo ⚠️  JWT_REFRESH_EXPIRY not found, adding default (7d)...
    echo JWT_REFRESH_EXPIRY=7d >> .env
)

echo ✅ Environment variables configured
echo.

REM Run database migration
echo 🗄️  Running database migration...
call npm run migration:run

if errorlevel 1 (
    echo ❌ Database migration failed
    exit /b 1
)

echo ✅ Database migration completed
echo.
echo 🎉 Setup complete!
echo.
echo Next steps:
echo 1. Update your frontend to implement token refresh
echo 2. Test the login flow
echo 3. Test the token refresh endpoint
echo 4. Review AUTH_IMPLEMENTATION_GUIDE.md for details
echo.
echo New endpoints available:
echo   POST /auth/refresh - Refresh access token
echo   POST /auth/revoke  - Revoke refresh token
echo.
echo Security improvements:
echo   ✅ Access tokens: 15 minutes (was 365 days)
echo   ✅ Refresh tokens: 7 days with revocation
echo   ✅ Rate limiting: 5 attempts per 15 minutes
echo   ✅ Secure cookies with proper expiration
echo.
