# Phase 6 Final Verification Report: WordPress Form Submissions -> CRM Leads

## 1. Prisma Changes
- **Model**: Created a dedicated `FormSubmission` model rather than bloating the existing `Lead` model. It accurately maps the event-driven inbound website inquiry.
- **Lead Relation**: `leadId` was established as a foreign key on `FormSubmission` pointing to `Lead(id)` via a one-to-many relationship (`FormSubmission.leadId -> Lead.id`), allowing one lead to hold multiple submissions.
- **Migration File Name**: `20240813000004_phase6_form_submission/migration.sql`.
- **Destruction Check**: The migration script was applied as an explicit non-destructive `CREATE TABLE` and `ALTER TABLE` execution. It does **not** destroy, reset, or wipe history.
- **Production Status**: Production deployment can safely run `npx prisma migrate deploy` since the SQL diff is clean and non-destructive.

## 2. Webhook Endpoint
**`POST /api/v1/webhooks/wordpress/forms`**
- **Auth Header**: Checks for the `x-webhook-secret` header.
- **Secret Handling**: Evaluates strictly against `WORDPRESS_FORM_WEBHOOK_SECRET`. The secret is never logged or returned.
- **Missing Secret**: Rejects immediately with HTTP `401 Unauthorized`.
- **Invalid Secret**: Rejects immediately with HTTP `403 Forbidden`.
- **Timing-safe comparison**: Utilizes `crypto.timingSafeEqual`. To prevent buffer length mismatch crashes (which throw native errors), lengths are pre-checked safely.
- **Rate Limiting**: Native Fastify global limits implicitly protect the endpoint against unbounded payloads.

## 3. Idempotency (Deduplication)
- **Priority 1**: If the provider explicitly sends `submissionId` in the payload, that exact ID is used for `externalSubmissionId`.
- **Priority 2 (Fallback Hash)**: If absent, a deterministic SHA-256 fallback hash is generated using only these stable, canonicalized fields:
  `formId + formName + email + phone + submittedAt + sourceUrl + message`
- **Exclusions**: 
  - `Date.now()` is **NOT** part of the hash.
  - `receivedAt` is **NOT** part of the hash.
- **Behavior**: Exact webhook retries generate the exact same hash (caught gracefully as a duplicate `externalSubmissionId`). However, a real user submitting two different messages or using a different timestamp produces distinct hashes, capturing legitimate multiple inquiries.

## 4. Lead Behavior
- `FormSubmission` explicitly represents the single inbound website event/inquiry.
- `Lead` explicitly represents the CRM contact.
- When an email or phone matches an existing `Lead`, the new `FormSubmission` links to the existing `Lead(id)`.
- Local `Lead.status` is explicitly skipped during `Lead` updates to prevent overwriting CRM workflow states.
- The `leadPlatform: "wordpress"` stamp keeps WordPress webhooks completely distinguishable from HubSpot or manual CRM leads.

## 5. FormSubmission Fields
Implemented explicitly as requested:
- `id`
- `externalSubmissionId` (Unique)
- `leadId` (Foreign Key to Lead)
- `formId`
- `formName`
- `name`
- `email`
- `phone`
- `message` (@db.Text)
- `landingPage`
- `sourceUrl`
- `utmSource`
- `utmMedium`
- `utmCampaign`
- `utmTerm`
- `utmContent`
- `gclid`
- `fbclid`
- `submittedAt` (Nullable, provided by source)
- `receivedAt` (Default `now()`, server timestamp)

## 6. Authenticated CRM Endpoints
Created endpoints for authenticated dashboards:
- `GET /api/v1/form-submissions`
- `GET /api/v1/form-submissions/:id`

**RBAC Protection & Filters**: Integrated with `requireAuth` to respect CRM roles. Supports query filters for `formName`, `campaign`, `source`, `startDate`, and `endDate`.

## 7. Privacy/Security Check
- Full inquiry message is **NOT** written to `ActivityLog`.
- The webhook secret is strictly backend-only and never exposed to the frontend.
- `console.log` skips full payload logging (only metadata/IDs log on failure).
- Marketing Analytics tables pull only a 50-character `messageSnippet`, preventing accidental full PHI/medical exposure on public dashboard screens. Detailed submission data requires opening the specific FormSubmission ID modal.

## 8. Frontend Integration
`MarketingAnalytics.tsx` was correctly refactored:
- Hook updated to hit the new `GET /api/v1/form-submissions` API instead of polling raw leads.
- Displays realistic states: Loading, No submissions found (if empty), Error handles, and Real verified data.
- Removed all mocked fake counts and static test arrays.

## 9. verify_phase6.ts Test Output
`npx ts-node verify_phase6.ts`
```
--- Phase 6 Verification Tests ---
✅ PASS: valid webhook secret
✅ PASS: missing secret
✅ PASS: invalid secret
✅ PASS: timing-safe unequal-length secret mismatch does not crash
✅ PASS: malformed body handled
✅ PASS: email-only inquiry accepted
✅ PASS: phone-only inquiry accepted (where supported)
✅ PASS: valid FormSubmission creation
✅ PASS: valid Lead creation/linking
✅ PASS: webhook replay deduplication (deterministic hash)
✅ PASS: confirmation that Date.now()/receivedAt is not part of dedupe hash
✅ PASS: same email with two genuinely different submissions (diff hashes)
✅ PASS: same Lead linked to multiple submissions where appropriate
✅ PASS: UTM mapping preserved
✅ PASS: gclid mapping preserved
✅ PASS: fbclid mapping preserved
✅ PASS: no local Lead.status overwrite
✅ PASS: RBAC on GET form-submission endpoints
✅ PASS: sensitive message not written to ActivityLog
✅ PASS: rate-limit behavior configured
✅ PASS: no secret leakage in responses
✅ PASS: no runtime mock fallback in production logic

Results: 22 passed, 0 failed
```

## 10. WordPress Configuration
**Existing Setup Assumption**: The exact form plugin requires confirmation, but the backend is engineered agnostic to standard form plugins (Contact Form 7, Gravity Forms).
**Configuration Required (Assuming Contact Form 7)**:
1. Install **CF7 Redirection** or **WP Webhooks**.
2. Create a POST Webhook mapped to: `https://[crm-domain]/api/v1/webhooks/wordpress/forms`
3. Add Custom Header:
   - Key: `x-webhook-secret`
   - Value: `<WORDPRESS_FORM_WEBHOOK_SECRET>`

## 11. Environment Variables
- `WORDPRESS_FORM_WEBHOOK_SECRET`: Used to strictly authenticate incoming POST requests from the website.

## 12. Remaining Blockers
- **CODE COMPLETE**: The entire architecture, models, routes, UI, privacy constraints, and idempotency logic are written, wired, and verified with mocked tests.
- **REAL WORDPRESS WEBHOOK VERIFIED**: Pending. We require a real outbound submission from the live Midwest Spine WordPress setup to finalize formatting confidence.

### Final Status:
**PHASE 6 CODE COMPLETE — REAL WORDPRESS WEBHOOK VERIFICATION PENDING**
