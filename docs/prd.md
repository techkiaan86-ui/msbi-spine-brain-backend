# Product Requirements Document (PRD) - Backend

## 1. Product Vision
To build a robust, scalable backend infrastructure that powers the Midwest Spine & Brain Institute (MSBI) Marketing Operations CRM. The backend will centralize data from disparate marketing channels, manage internal workflows (budgets, campaigns, vendors), and provide secure, high-performance data delivery to the frontend dashboard.

## 2. Target Audience
- **Marketing Managers:** Tracking ROI, managing campaigns and budgets.
- **Executives:** Viewing high-level performance reports and clinic ratings.
- **Clinic Staff:** Managing review requests and vendor relationships.

## 3. Key Objectives & Success Metrics
- **Performance:** API endpoints must return data in < 200ms on average.
- **Reliability:** Background sync jobs with GA4, Ads, and Meta must achieve 99.9% uptime.
- **Security:** Strict RBAC ensuring that sensitive budget and vendor contract data is only accessible to authorized roles.

## 4. Feature Requirements (Backend Scope)

### 4.1 Authentication & RBAC
- Implement session management using Better Auth.
- Support multiple roles (Admin, Manager, Viewer).
- Granular permission checks at the route level.

### 4.2 Data Aggregation Engine
- Built-in scheduled tasks (Cron) to poll data from external APIs (Google Analytics 4, Meta Ads, CallRail).
- Normalize external data into the local PostgreSQL database for fast querying.

### 4.3 CRUD APIs for Core Modules
- Full RESTful APIs to support Campaign, Budget, Reputation, and Vendor Management frontends.
- File upload handling (via AWS S3) for vendor contracts and campaign assets.

### 4.4 Reporting Engine
- Endpoint to aggregate cross-module data for the "Executive Dashboard".
- Asynchronous task queuing for generating heavy PDF/Excel exports.

## 5. Out of Scope for Phase 1
- Real-time WebSockets (all updates will be pull-based via TanStack query on the frontend).
- Two-Factor Authentication (2FA) (to be added in Phase 2).
- Direct bi-directional sync (e.g., creating a Google Ad campaign *from* the CRM). The CRM is read-only for external platform data.

## 6. Milestones & Timeline
- **Week 1:** Database Schema Design & Prisma Setup.
- **Week 2:** Authentication & Core CRUD APIs (Campaigns, Vendors, Users).
- **Week 3:** Advanced Modules (Budgets, Reputation) and File Uploads.
- **Week 4:** External API Integrations (GA4, CallRail) & Cron Jobs.
- **Week 5:** Security Audits, Testing, and Staging Deployment.
