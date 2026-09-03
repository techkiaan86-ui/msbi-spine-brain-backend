# MSBI Marketing Operations CRM - API Specification

## Base URL
`/api/v1`

## Authentication
All endpoints except `/auth/login` require an `Authorization: Bearer <token>` header.

---

### 1. Authentication
- `POST /auth/login` - Authenticate user and return JWT.
- `POST /auth/logout` - Invalidate session.
- `GET /auth/me` - Get current user profile and permissions.

### 2. Dashboard
- `GET /dashboard/summary` - Fetch high-level KPIs (Traffic, Leads, ROI, Spend) for the main dashboard.

### 3. Marketing Analytics
- `GET /analytics/overview` - Aggregated marketing data.
- `GET /analytics/website` - Traffic, bounce rate, sessions.
- `GET /analytics/leads` - Lead volume by source.
- `GET /analytics/calls` - Call tracking metrics.
- `GET /analytics/roi` - ROI calculations based on spend vs. conversion value.

### 4. Campaign Management
- `GET /campaigns` - List all campaigns (filters: active, past).
- `POST /campaigns` - Create a new campaign.
- `GET /campaigns/:id` - Get campaign details.
- `PUT /campaigns/:id` - Update campaign status/budget.
- `GET /campaigns/:id/tasks` - Get tasks for a campaign.
- `POST /campaigns/:id/tasks` - Add a new task.

### 5. Budget Management
- `GET /budget/overview` - Get annual/monthly budget overview.
- `GET /budget/planned-vs-actual` - Compare planned budget vs actual expenses.
- `POST /budget/expenses` - Log a new expense.
- `GET /budget/vendor-spending` - Aggregate spend by vendor.

### 6. Reputation Management
- `GET /reputation/reviews` - Fetch aggregated Google reviews.
- `GET /reputation/clinics` - Average ratings grouped by clinic.
- `GET /reputation/providers` - Average ratings grouped by provider.
- `POST /reputation/requests` - Trigger a review request (SMS/Email).

### 7. Vendor Management
- `GET /vendors` - List all vendors.
- `POST /vendors` - Add a new vendor.
- `GET /vendors/:id/contracts` - Get contracts for a vendor.
- `GET /vendors/renewals` - Get upcoming contract renewals (Next 30/60/90 days).
- `GET /vendors/:id/invoices` - List vendor invoices.

### 8. Reports
- `POST /reports/generate` - Generate a report asynchronously (PDF/Excel).
- `GET /reports/exports` - List available exports to download.

### 9. Integrations
- `GET /integrations/status` - Check connection status of all 3rd party tools (GA4, Ads, HubSpot).
- `POST /integrations/sync` - Manually trigger data sync for a specific integration.

### 10. Users & Roles
- `GET /users` - List all system users.
- `POST /users` - Invite/create a new user.
- `GET /roles` - List all RBAC roles.
- `GET /activity-logs` - Fetch audit logs for system actions.

### 11. Settings
- `GET /settings/organization` - Get org settings.
- `PUT /settings/organization` - Update org settings.
- `GET /settings/clinics` - Manage clinic list.
- `GET /settings/providers` - Manage provider list.
