# LegalLens — TypeScript Backend Server

Production-grade, modular Node.js/TypeScript backend architecture for **LegalLens**, designed in strict alignment with Functional and Non-Functional Requirements (FR & NFR) for legal digital evidence management, image forensics, organization governance, chain-of-custody preservation, and immutable audit tracking.

---

## 🏗 System Architecture & Directory Structure

```
backend-server/
├── src/
│   ├── config/
│   │   ├── constants.ts        # Quotas, media MIME types, status enums, fusion weights
│   │   ├── database.ts         # Resilient MongoDB connection via Mongoose
│   │   └── env.ts              # Strongly-typed environment variables (8h JWT expiration)
│   │
│   ├── controllers/
│   │   ├── auth.controller.ts          # Auth, logout, Bar ID verification, password reset
│   │   ├── organization.controller.ts  # Super admin governance & org admin lawyer roster
│   │   ├── case.controller.ts          # Case lifecycle management (CRUD, status, read-only lock, delete)
│   │   ├── file.controller.ts          # Multi-media ingestion, in-browser preview, soft deletion
│   │   ├── forensics.controller.ts     # 6-module analysis, fusion score, reverse image search
│   │   ├── notification.controller.ts  # Alert notifications (completion, failure, quota limits)
│   │   ├── audit.controller.ts         # Immutable audit log query & per-case history
│   │   └── report.controller.ts        # Single PDF case report export summary
│   │
│   ├── middleware/
│   │   ├── auth.middleware.ts          # 8h session JWT, token revocation, RBAC, Bar ID check
│   │   ├── errorHandler.middleware.ts  # Unified error envelope { success: false, error }
│   │   ├── notFound.middleware.ts      # 404 Route handler
│   │   ├── upload.middleware.ts        # Multer multi-media validation (100MB top limit)
│   │   └── validate.middleware.ts      # Request body and query validation using Zod
│   │
│   ├── models/
│   │   ├── organization.model.ts       # Orgs, pooled storage, monthly forensic limits (FR-9)
│   │   ├── user.model.ts               # Super Admin, Org Admin, Org/Solo Lawyers (FR-1)
│   │   ├── case.model.ts               # Case workspace & metadata (FR-2.1)
│   │   ├── file.model.ts               # File records with SHA-256 hashes & processing status (FR-3.6, 3.9)
│   │   ├── forensicResult.model.ts     # 6-module results & Evidence Fusion (FR-4.7, 4.10)
│   │   ├── reverseSearch.model.ts      # External reverse image search results (FR-4.12, 4.13)
│   │   ├── notification.model.ts       # In-app processing & quota notifications (FR-5)
│   │   ├── tokenBlacklist.model.ts     # Invalidation of session tokens upon logout (FR-1.8)
│   │   ├── auditLog.model.ts           # Immutable audit entries (FR-7.1, FR-10)
│   │   └── report.model.ts             # Exported report history (FR-6.4)
│   │
│   ├── routes/
│   │   ├── auth.routes.ts              # /api/auth (login, logout, register, reset, verify-bar)
│   │   ├── organization.routes.ts      # /api/super-admin and /api/organizations
│   │   ├── case.routes.ts              # /api/cases
│   │   ├── file.routes.ts              # /api/cases/:caseId/files & /api/files/:fileId
│   │   ├── forensics.routes.ts         # /api/files/:fileId/analyze & reverse-search
│   │   ├── notification.routes.ts      # /api/notifications
│   │   ├── audit.routes.ts             # /api/cases/:caseId/history & /api/audit
│   │   ├── report.routes.ts            # /api/cases/:caseId/export
│   │   └── index.ts                    # Master API router
│   │
│   ├── services/
│   │   ├── auth.service.ts             # Password hashing, 8h JWTs, logout blacklist, reset flows
│   │   ├── organization.service.ts     # Pooled storage, max user checks, monthly quota auto-reset
│   │   ├── case.service.ts             # Case business logic & duplicate client warnings
│   │   ├── file.service.ts             # Dual storage, SHA-256 integrity, in-browser preview stream
│   │   ├── forensics.service.ts        # Evidence Fusion, monthly limits, Python FastAPI bridge
│   │   ├── reverseSearch.service.ts    # Web image similarity lookups
│   │   ├── notification.service.ts     # Notification dispatcher (completed, failed, quota alerts)
│   │   ├── audit.service.ts            # Immutable audit logging engine
│   │   └── report.service.ts           # Aggregation for forensic report export
│   │
│   ├── types/                          # Central TypeScript interface declarations
│   ├── utils/                          # ApiResponse formatting, SHA-256 hashing, Logger
│   ├── validators/                     # Zod validation schemas
│   ├── app.ts                          # Express application assembly
│   └── server.ts                       # Server entrypoint
├── .env.example
├── package.json
└── tsconfig.json
```

---

## 🛡 Functional Requirements (FR) Coverage Matrix

| Requirement | Description | Implementation Component |
|---|---|---|
| **FR1.1** | Super Admin registers organization & admin email | `OrganizationService.createOrganization`, `UserModel` |
| **FR1.2** | Org Admin manages lawyer accounts (add/view/update/remove) | `OrganizationService.addLawyerToOrg`, `OrganizationController` |
| **FR1.3** | Org Admin registers lawyer with email & Bar ID | `registerOrgLawyerSchema`, `OrganizationService.addLawyerToOrg` |
| **FR1.4** | Independent lawyer self-registration with Bar ID | `AuthService.registerIndependent`, `registerIndependentSchema` |
| **FR1.5** | Bar ID verification before activation | `AuthService.verifyBarId`, `requireVerifiedBarId` middleware |
| **FR1.6** | Mandatory field validation | Zod schemas via `validateBody` / `validateQuery` |
| **FR1.7** | Email + password login, 8-hour inactivity session | `AuthService.login`, `JWT_EXPIRES_IN='8h'` |
| **FR1.8** | Session invalidation upon logout | `AuthService.logout`, `TokenBlacklistModel` |
| **FR1.9** | Protected route redirection/rejection | `requireAuth` middleware |
| **FR1.10** | Credential sanitization (passwords never logged/returned) | `UserModel.select: false`, sanitized DTOs |
| **FR1.11** | User forgot & reset password flow | `AuthService.forgotPassword`, `AuthService.resetPassword` |
| **FR1.12** | Org Admin resets lawyer password | `AuthService.adminResetUserPassword` |
| **FR2.1 – 2.6** | Case CRUD, status (Open/Closed), typed deletion | `CaseService`, `CaseModel`, `CaseController` |
| **FR2.7** | Storage allocation per org / independent lawyer | `OrganizationService.checkStorageAvailable` |
| **FR2.8** | Duplicate client name warning (non-blocking) | `CaseService.createCase` duplicate warning check |
| **FR2.9** | Case descriptions (view and update) | `CaseModel.description`, `UpdateCaseDto` |
| **FR3.1** | Drag-and-drop batch upload | `FileService.uploadFiles`, `upload.array('files', 20)` |
| **FR3.2** | Accepted formats (Images, Docs, Video, Audio) | `upload.middleware.ts`, `ALLOWED_MIME_TYPES` |
| **FR3.3** | Size limits (5MB img/aud, 25MB doc, 100MB vid) | `FileService.getCategorySizeLimit`, strict pre-checks |
| **FR3.4** | Dual storage: unmodified original + working copy | `FileService.uploadFiles` dual write architecture |
| **FR3.5** | Ingestion SHA-256 hash computation | `computeSha256` digest on byte stream |
| **FR3.6** | File record metadata persistence | `FileModel` (`fileId`, `hash`, `fileCategory`, etc.) |
| **FR3.7** | Soft-delete file (hidden from UI, retained for audit) | `FileService.deleteFile` (`isDeleted: true`) |
| **FR3.8** | In-browser preview without downloading or altering original | `FileService.getFilePreviewStream`, `/files/:fileId/preview` |
| **FR3.9** | File processing status (`Pending`, `Processing`, `Completed`, `Failed`) | `FileModel.processingStatus`, `FILE_PROCESSING_STATUS` |
| **FR4.1 – 4.6** | 6-Module Forensics (EXIF, ELA, Clone, Noise, Light, CNN) | `ForensicsService.analyzeFile`, Python FastAPI bridge |
| **FR4.7** | Evidence Fusion Algorithm (0–1 score + dynamic weights) | `ForensicsService.computeFusionScore` |
| **FR4.8** | Automatic forensic analysis upon image upload | `FileService.uploadFiles` asynchronous trigger |
| **FR4.9** | Module failure isolation (`not_applicable` tolerance) | `ForensicsService.sanitizeModuleResult` |
| **FR4.10** | Forensic result persistence & re-viewing | `ForensicResultModel`, `ForensicResultSchema` |
| **FR4.11** | Manual re-triggering subject to monthly quota | `ForensicsController.analyzeFile` |
| **FR4.12 – 4.13** | Reverse Image Search & results display | `ReverseSearchService`, `ReverseSearchModel` |
| **FR5.1 – 5.5** | Real-time status & notifications (completed, failed, quota) | `NotificationService`, `NotificationModel` |
| **FR6.1 – 6.5** | Case report export & retention | `ReportService.generateCaseReportSummary`, `ReportModel` |
| **FR7.1 – 7.3** | Immutable audit trail & per-case history | `AuditService`, `AuditLogModel`, `AuditController` |
| **FR8.1 – 8.2** | Human-readable errors & standard envelope | `errorHandler.middleware.ts`, `sendError` |
| **FR9.1 – 9.9** | Super Admin org management, pooled quotas, monthly limits | `OrganizationService`, `OrganizationModel` |
| **FR10** | Super Admin audit trail logging | `AuditService.logAction` on all Super Admin actions |
| **NFR Privacy** | Super Admin strictly isolated from case contents | `restrictSuperAdminFromCases` middleware |
| **NFR Integrity** | Pre-analysis SHA-256 integrity verification | `ForensicsService.analyzeFile` hash verification |

---

## ⚡ Evidence Fusion Algorithm (FR-4.7)

Fusion Authenticity Score combines applicable module sub-scores (0.00–1.00):
- **0.00 – 0.30**: `Authentic`
- **0.31 – 0.65**: `Suspicious`
- **0.66 – 1.00**: `Highly Manipulated`

If any module is `not_applicable`, its weight is excluded, and the remaining applicable module weights are dynamically normalized to sum to `1.0`.

---

## 🚀 Getting Started

### 1. Prerequisites
- Node.js >= 20
- MongoDB instance running locally or on MongoDB Atlas

### 2. Environment Setup
Copy `.env.example` to `.env` and configure credentials:
```bash
cp .env.example .env
```

### 3. Type Checking
```bash
npm run typecheck
```

### 4. Development Server
```bash
npm run dev
```
