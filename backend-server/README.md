# LegalLens — TypeScript Backend Server

Production-grade, modular Node.js/TypeScript backend architecture for **LegalLens**, designed in strict alignment with Functional and Non-Functional Requirements (FR & NFR) for legal image forensics, chain-of-custody management, and audit tracking.

---

## 🏗 System Architecture & Directory Structure

```
backend-server/
├── src/
│   ├── config/
│   │   ├── constants.ts        # Business rules, weights, allowed MIME types, status enums
│   │   ├── database.ts         # Resilient MongoDB connection via Mongoose
│   │   └── env.ts              # Strongly-typed environment variables
│   │
│   ├── controllers/
│   │   ├── auth.controller.ts      # Authentication & user profile endpoints
│   │   ├── case.controller.ts      # Case lifecycle management (CRUD, status, lock, delete)
│   │   ├── file.controller.ts      # File ingestion, original preservation, soft deletion
│   │   ├── forensics.controller.ts # Forensic pipeline execution, sub-scores, re-trigger
│   │   ├── audit.controller.ts     # Immutable audit log query & per-case history
│   │   └── report.controller.ts    # Single PDF case report export summary
│   │
│   ├── middleware/
│   │   ├── auth.middleware.ts         # JWT Bearer token authentication
│   │   ├── errorHandler.middleware.ts # Unified error shape (FR-6.2)
│   │   ├── notFound.middleware.ts     # 404 Route handler
│   │   ├── upload.middleware.ts       # Multer multi-file upload & size validation
│   │   └── validate.middleware.ts     # Request validation using Zod
│   │
│   ├── models/
│   │   ├── auditLog.model.ts       # Immutable audit entries (FR-7.1)
│   │   ├── case.model.ts           # Case workspace & metadata (FR-2.1)
│   │   ├── file.model.ts           # File records with SHA-256 hashes (FR-3.6)
│   │   ├── forensicResult.model.ts # 6-module results & Evidence Fusion (FR-4.7, 4.10)
│   │   ├── report.model.ts         # Exported report history (FR-5.4)
│   │   └── user.model.ts           # Users & credentials
│   │
│   ├── routes/
│   │   ├── auth.routes.ts          # /api/auth
│   │   ├── case.routes.ts          # /api/cases
│   │   ├── file.routes.ts          # /api/cases/:caseId/files & /api/files/:fileId
│   │   ├── forensics.routes.ts     # /api/files/:fileId/analyze
│   │   ├── audit.routes.ts         # /api/cases/:caseId/history
│   │   ├── report.routes.ts        # /api/cases/:caseId/export
│   │   └── index.ts                # Master API router
│   │
│   ├── services/
│   │   ├── audit.service.ts        # Immutable audit logging engine
│   │   ├── auth.service.ts         # Password hashing & 7-day JWT generation
│   │   ├── case.service.ts         # Case business logic & duplicate client warnings
│   │   ├── file.service.ts         # Dual storage (unmodified original + working copy) & SHA-256
│   │   ├── forensics.service.ts    # Evidence Fusion algorithm & Python FastAPI bridge
│   │   └── report.service.ts       # Aggregation for forensic report export
│   │
│   ├── types/                      # Central TypeScript interface declarations
│   ├── utils/                      # ApiResponse formatting, SHA-256 hashing, Logger
│   ├── validators/                 # Zod validation schemas
│   ├── app.ts                      # Express application assembly
│   └── server.ts                   # Server entrypoint
├── .env.example
├── package.json
└── tsconfig.json
```

---

## 🛡 Functional Requirements (FR) Coverage

| Section | Requirement | Implementation |
|---|---|---|
| **5.1 Auth** | **FR-1.1 – 1.4** | JWT (7-day validity), bcrypt password hashing, passwords never logged or returned, protected route middleware |
| **5.2 Case Workspace** | **FR-2.1 – 2.7** | UUID `case_id`, metadata management, closed cases made read-only, typed-confirmation permanent deletion, duplicate client name warnings |
| **5.3 File Upload** | **FR-3.1 – 3.7** | Multi-file batch upload, format check (JPEG, PNG, WEBP, PDF, DOCX, TXT), size limits (10MB image, 25MB doc), SHA-256 ingestion hash, unmodified original + working copy storage, soft delete |
| **5.4 Forensics Pipeline** | **FR-4.1 – 4.11** | Integration with Python service, 6-module analysis (EXIF, ELA, Copy-Move, Noise, Lighting, Deepfake), Evidence Fusion score (0.00-1.00) with weight normalization, persistence, re-triggering |
| **5.5 Reports** | **FR-5.1 – 5.4** | Case report metadata compilation, read-only export, timestamped report retention |
| **5.6 Error Handling** | **FR-6.1 – 6.2** | Standardized response format `{ success, data/error: { code, message, details } }` |
| **5.7 Audit Log** | **FR-7.1 – 7.3** | Immutable audit records for all core user actions, per-case chronological history view |

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
Copy `.env.example` to `.env` and adjust if needed:
```bash
cp .env.example .env
```

### 3. Run Development Server
```bash
npm run dev
```

### 4. Type Checking
```bash
npm run typecheck
```
