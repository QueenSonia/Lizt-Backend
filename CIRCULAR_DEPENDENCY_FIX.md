# Circular Dependency Fix - Complete Solution

## Issue

```
UndefinedModuleException [Error]: Nest cannot create the KYCLinksModule instance.
UndefinedDependencyException [Error]: Nest can't resolve dependencies of the KYCLinksService
(KYCLinkRepository, PropertyRepository, KYCOtpRepository, ConfigService, ?, UtilService).
```

## Root Cause

Circular dependency between modules and services:

- `WhatsappBotModule` imports `KYCLinksModule`
- `KYCLinksModule` imports `WhatsappBotModule`
- `KYCLinksService` injects `WhatsappBotService`
- `LandlordFlow` (in WhatsappBotModule) injects `KYCLinksService`

## Complete Solution

### 1. Updated `whatsapp-bot.module.ts`

Changed from:

```typescript
imports: [
  // ...
  KYCLinksModule,
];
```

To:

```typescript
imports: [
  // ...
  forwardRef(() => KYCLinksModule),
];
```

### 2. Updated `kyc-links.module.ts`

Changed from:

```typescript
imports: [
  // ...
  WhatsappBotModule,
  // ...
];
```

To:

```typescript
imports: [
  // ...
  forwardRef(() => WhatsappBotModule),
  // ...
];
```

### 3. Updated `landlordflow.ts`

Added `@Inject(forwardRef())` to the constructor:

```typescript
import { Injectable, Inject, forwardRef } from '@nestjs/common';

constructor(
  // ... other dependencies
  @Inject(forwardRef(() => KYCLinksService))
  private readonly kycLinksService: KYCLinksService,
) {
  // ...
}
```

### 4. Updated `kyc-links.service.ts`

Added `@Inject(forwardRef())` to the constructor:

```typescript
import {
  Injectable,
  Inject,
  forwardRef,
  // ... other imports
} from '@nestjs/common';

constructor(
  // ... other dependencies
  @Inject(forwardRef(() => WhatsappBotService))
  private readonly whatsappBotService: WhatsappBotService,
  // ...
) {}
```

## How forwardRef() Works

- `forwardRef()` delays the resolution of the module/service reference
- Allows NestJS to resolve circular dependencies by deferring the lookup
- Both modules can now reference each other without causing initialization errors
- **CRITICAL:** When you have circular dependencies:
  1. Both modules must use `forwardRef()` in their imports
  2. Both services must use `@Inject(forwardRef())` in their constructors

## Files Modified

1. `lizt-backend/src/whatsapp-bot/whatsapp-bot.module.ts`
2. `lizt-backend/src/kyc-links/kyc-links.module.ts`
3. `lizt-backend/src/whatsapp-bot/templates/landlord/landlordflow.ts`
4. `lizt-backend/src/kyc-links/kyc-links.service.ts` ✨ **New**

## Verification

✅ No compilation errors
✅ Module dependencies resolved correctly
✅ Service dependencies resolved correctly
✅ Application should start successfully

---

**Date:** November 26, 2025
**Status:** Complete
