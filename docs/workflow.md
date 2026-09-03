# MSBI Marketing Operations CRM - System Workflows

## 1. Authentication & Authorization Workflow
1. **Login:** User submits credentials to `POST /auth/login`.
2. **Validation:** Backend verifies credentials against DB.
3. **Session Creation:** Better Auth creates a secure session and issues a JWT / HTTP-only cookie.
4. **RBAC Verification:** On every protected API request, a Fastify middleware extracts the user's role and checks it against the endpoint's required permissions. If unauthorized, returns `403 Forbidden`.

## 2. Data Integration Sync Workflow (ETL)
Since the CRM relies heavily on third-party data (GA4, Google Ads, Meta Ads):
1. **Cron Jobs:** A scheduled worker runs periodically (e.g., nightly) to fetch data from 3rd party APIs.
2. **Transformation:** Data is cleaned and mapped to MSBI's internal database schema (AnalyticsSnapshot).
3. **Storage:** Standardized data is saved to PostgreSQL.
4. **Serving:** When the frontend requests `/analytics/overview`, the backend serves the pre-aggregated data from PostgreSQL rather than querying live APIs, ensuring fast dashboard load times.

## 3. Campaign & Budget Tracking Workflow
1. **Creation:** Marketer creates a Campaign with a set `budget`.
2. **Execution:** As invoices come in, they are logged under `Budget Management -> Expenses` and tied to the Campaign ID.
3. **Calculation:** The backend dynamically calculates the `spend` and `remaining_budget` whenever the campaign details are fetched.

## 4. Reputation Request Workflow
1. **Trigger:** Front-desk staff clicks "Send Review Request" in the CRM.
2. **API Call:** Frontend calls `POST /reputation/requests`.
3. **Processing:** Backend saves the request in the database with status `PENDING`.
4. **Integration:** Backend triggers an external service (e.g., Twilio for SMS or AWS SES for Email) to send the link to the patient.
5. **Update:** Upon successful dispatch, status updates to `SENT`.
