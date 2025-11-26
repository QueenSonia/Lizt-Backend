# Circular Dependency Fix

## Issue

```
UndefinedModuleException [Error]: Nest cannot create the KYCLinksModule instance.
The module at index [2] of the KYCLinksModule "imports" array is undefined.
Potential causes:
- A circular dependency between modules.
```

## Root Cause

Circular dependency between modules:

- `WhatsappBotModule` imports `KYCLinksModule`
- `KYCLinksModule` imports `WhatsappBotModule`

## Solution

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

### 2. Updated `landlordflow.ts`

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

## How forwardRef() Works

- `forwardRef()` delays the resolution of the module/service reference
- Allows NestJS to resolve circular dependencies by deferring the lookup
- Both modules can now reference each other without causing initialization errors

## Verification

✅ No compilation errors
✅ Module dependencies resolved correctly
✅ Application starts successfully

---

**Date:** November 26, 2025
