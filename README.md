# LegalLens — Core Backend Platform

Comprehensive digital evidence management and multi-modal image forensics system designed for legal teams, law firms, and independent lawyers.

---

## 📚 Complete Project Context & Specification
- Detailed Functional Requirements (FR1 to FR10) and Non-Functional Requirements (NFR): [APP_CONTEXT.md](file:///Users/macbookpro/projects/university/FYP/docs/APP_CONTEXT.md)
- TypeScript API Server Documentation: [backend-server/README.md](file:///Users/macbookpro/projects/university/FYP/LegalLens_backend/backend-server/README.md)

---

## 🏗 Architectural Overview

- **`backend-server/`**: Express.js & TypeScript microservice providing:
  - Role-based Access Control (Super Admin, Organization Admin, Organization Lawyer, Independent Lawyer)
  - Organization pooled storage and monthly forensic quota governance
  - Bar ID verification and 8-hour inactivity session management
  - Multi-media evidence ingestion (Images, Documents, Video, Audio) with SHA-256 integrity digests
  - Evidence Fusion scoring engine (0.00 - 1.00)
  - Reverse Image Search integration
  - Real-time in-app notifications
  - Immutable audit trails and legal PDF report exports
- **`Image-forensics/`**: Python & FastAPI forensic computing engine running PyTorch deep learning models (ResNet50 / Grad-CAM), ELA, copy-move detection, noise residual analysis, and lighting inconsistency estimation.
