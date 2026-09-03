# MSBI Marketing Operations CRM - Backend Overview

## 1. Introduction
This document provides a high-level overview of the backend architecture for the Midwest Spine & Brain Institute (MSBI) Marketing Operations CRM. The backend is designed to serve as a robust, scalable, and secure API layer supporting a comprehensive enterprise SaaS dashboard.

## 2. Technology Stack
- **Runtime Environment:** Node.js
- **Web Framework:** Fastify (Chosen for high performance and low overhead)
- **Database:** PostgreSQL (Relational database for structured CRM data)
- **ORM:** Prisma (Type-safe database access)
- **Authentication:** Better Auth (Secure session management and JWT handling)
- **Cloud/Storage:** AWS S3 (For document and asset storage)
- **Deployment:** Docker, Nginx, Hostinger VPS / AWS

## 3. Core Modules & Responsibilities
The backend mirrors the frontend requirements, providing API endpoints and data processing for the following 10 core modules:

1. **Dashboard & Analytics:** Aggregating data from GA4, Ads, and internal metrics.
2. **Campaign Management:** CRUD operations for marketing campaigns, tasks, and assets.
3. **Budget Management:** Tracking planned vs. actual spend and vendor allocations.
4. **Reputation Management:** Fetching and storing reviews, tracking provider/clinic ratings.
5. **Vendor Management:** Managing vendor profiles, contracts, and invoices.
6. **Reports:** Generating dynamic data sets for executive and custom reports.
7. **Integrations:** Webhooks and OAuth flows for 3rd party services (HubSpot, Mailchimp, CallRail, etc.).
8. **Users & Roles (RBAC):** Managing staff accounts, clinic assignments, and department permissions.
9. **Settings:** Organization-wide configurations and API key management.
10. **Clinical Intelligence:** (Future scope) Specialized clinic-level data processing.

## 4. System Architecture
- **Client-Server Communication:** The frontend (React/Vite) communicates with the Fastify backend via RESTful JSON APIs.
- **Security:** All endpoints (except public webhooks/login) are protected by Bearer token authentication and Role-Based Access Control (RBAC) middleware.
- **Data Validation:** Fastify integrates with JSON Schema/Zod for strict request payload validation.
