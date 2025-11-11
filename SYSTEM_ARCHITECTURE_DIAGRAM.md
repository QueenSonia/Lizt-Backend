# Panda Homes - System Architecture Diagram

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENT LAYER                             │
├─────────────────────────────────────────────────────────────────┤
│  Web App (React)  │  Mobile App  │  WhatsApp Bot  │  API Clients│
└────────┬────────────────────┬────────────────┬──────────────────┘
         │                    │                │
         │                    │                │
         ▼                    ▼                ▼
┌─────────────────────────────────────────────────────────────────┐
│                      API GATEWAY / LOAD BALANCER                 │
└────────┬────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│                     MIDDLEWARE LAYER                             │
├─────────────────────────────────────────────────────────────────┤
│  CORS  │  Helmet  │  Cookie Parser  │  Compression  │  Logging  │
└────────┬────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│                   AUTHENTICATION & AUTHORIZATION                 │
├─────────────────────────────────────────────────────────────────┤
│  JWT Auth Guard  │  Role Guard  │  Validation Pipe              │
└────────┬────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│                      CONTROLLER LAYER                            │
├──────────┬──────────┬──────────┬──────────┬──────────┬──────────┤
│  Users   │Properties│  Rents   │ Service  │   KYC    │  Chat    │
│Controller│Controller│Controller│ Requests │  Links   │ Gateway  │
└────┬─────┴────┬─────┴────┬─────┴────┬─────┴────┬─────┴────┬─────┘
     │          │          │          │          │          │
     ▼          ▼          ▼          ▼          ▼          ▼
┌─────────────────────────────────────────────────────────────────┐
│                       SERVICE LAYER                              │
├──────────┬──────────┬──────────┬──────────┬──────────┬──────────┤
│  Users   │Properties│  Rents   │ Service  │   KYC    │  Chat    │
│ Service  │ Service  │ Service  │ Requests │  Links   │ Service  │
│          │          │          │ Service  │ Service  │          │
└────┬─────┴────┬─────┴────┬─────┴────┬─────┴────┬─────┴────┬─────┘
     │          │          │          │          │          │
     ▼          ▼          ▼          ▼          ▼          ▼
```

┌─────────────────────────────────────────────────────────────────┐
│ REPOSITORY / ORM LAYER │
├─────────────────────────────────────────────────────────────────┤
│ TypeORM │
│ (Entities, Repositories, Query Builder, Migrations) │
└────────┬────────────────────────────────────────────────────────┘
│
▼
┌─────────────────────────────────────────────────────────────────┐
│ DATABASE LAYER │
├─────────────────────────────────────────────────────────────────┤
│ PostgreSQL (Neon) │
│ Users │ Properties │ Rents │ Service Requests │ KYC │ etc. │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ EXTERNAL SERVICES │
├──────────┬──────────┬──────────┬──────────┬──────────┬──────────┤
│Cloudinary│ SendGrid │ Twilio │ WhatsApp │ Redis │ Swagger │
│ (Images) │ (Email) │ (SMS) │ API │ (Cache) │ (Docs) │
└──────────┴──────────┴──────────┴──────────┴──────────┴──────────┘

┌─────────────────────────────────────────────────────────────────┐
│ BACKGROUND JOBS │
├─────────────────────────────────────────────────────────────────┤
│ Rent Reminders │ Overdue Checks │ KYC Cleanup │ Move-Outs│
└─────────────────────────────────────────────────────────────────┘

```

## Data Flow Example: Creating a Service Request

```

1. Tenant (Web/WhatsApp)
   │
   ▼
2. POST /service-requests
   │
   ▼
3. Middleware Layer
   ├─ CORS Check ✓
   ├─ JWT Validation ✓
   └─ Role Check (TENANT) ✓
   │
   ▼
4. ServiceRequestsController
   ├─ Validate DTO
   └─ Extract user from token
   │
   ▼
5. ServiceRequestsService
   ├─ Generate request_id (#SR12345)
   ├─ Get tenant & property info
   ├─ Create ServiceRequest entity
   ├─ Save to database
   ├─ Emit 'service_request.created' event
   └─ Return created request
   │
   ▼
6. Event Listeners
   ├─ NotificationService → Create notification
   └─ WhatsAppBotService → Send WhatsApp to landlord/facility manager
   │
   ▼
7. Response to Client
   {
   "statusCode": 201,
   "data": { request_id, status, ... }
   }

```

## Module Dependencies

```

AppModule
├── ConfigModule (Global)
├── TypeOrmModule (Database)
├── AppCacheModule (Redis)
├── EventEmitterModule (Events)
├── ScheduleModule (Cron Jobs)
│
├── AuthModule
│ └── JwtModule
│
├── UsersModule
│ ├── TypeOrmModule.forFeature([Users, Account, KYC, Team, TeamMember])
│ └── AuthModule
│
├── PropertiesModule
│ ├── TypeOrmModule.forFeature([Property, PropertyTenant, PropertyHistory])
│ ├── UsersModule
│ └── RentsModule
│
├── RentsModule
│ ├── TypeOrmModule.forFeature([Rent, RentIncrease])
│ └── PropertiesModule
│
├── ServiceRequestsModule
│ ├── TypeOrmModule.forFeature([ServiceRequest])
│ ├── PropertiesModule
│ ├── UsersModule
│ └── ChatModule
│
├── KYCLinksModule
│ ├── TypeOrmModule.forFeature([KYCLink, KYCOtp, KYCApplication])
│ ├── PropertiesModule
│ └── WhatsappBotModule
│
├── NotificationModule
│ ├── TypeOrmModule.forFeature([Notification])
│ └── EventEmitterModule
│
├── ChatModule
│ ├── TypeOrmModule.forFeature([ChatMessage])
│ └── WebSocketsModule
│
└── WhatsappBotModule
├── TypeOrmModule.forFeature([Users, ServiceRequest, PropertyTenant, etc.])
├── UsersModule
├── PropertiesModule
└── ServiceRequestsModule

```

This architecture provides a scalable, maintainable, and secure foundation for the property management platform.
```
