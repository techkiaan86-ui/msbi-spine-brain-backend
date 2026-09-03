# MSBI Marketing Operations CRM - Database Architecture

## Overview
The backend uses PostgreSQL managed by Prisma ORM. Below is the proposed database architecture detailing the core entities mapped to the CRM's modules.

## Core Entities & Relationships

### 1. Users & RBAC (Users & Roles)
- **User:** `id`, `email`, `password_hash`, `first_name`, `last_name`, `role_id`, `department_id`, `created_at`, `updated_at`
- **Role:** `id`, `name` (e.g., Admin, Marketer, Manager), `permissions` (JSON)
- **Department:** `id`, `name`
- **ActivityLog:** `id`, `user_id`, `action`, `resource`, `timestamp`

### 2. Organization & Settings
- **Organization:** `id`, `name`, `timezone`, `currency`
- **Clinic:** `id`, `name`, `address`, `phone`
- **Provider:** `id`, `name`, `specialty`, `clinic_id`
- **IntegrationCredentials:** `id`, `platform_name` (e.g., GA4, Meta), `api_key`, `access_token`, `refresh_token`

### 3. Campaign Management
- **Campaign:** `id`, `name`, `status`, `start_date`, `end_date`, `budget`, `spend`, `goal`, `owner_id`
- **CampaignTask:** `id`, `campaign_id`, `title`, `status`, `due_date`, `assigned_to`
- **CampaignAsset:** `id`, `campaign_id`, `file_url`, `file_type`

### 4. Budget Management
- **Budget:** `id`, `year`, `month`, `total_planned`, `total_actual`
- **Expense:** `id`, `budget_id`, `category`, `amount`, `vendor_id`, `date`

### 5. Reputation Management
- **Review:** `id`, `platform` (Google), `rating`, `comment`, `author`, `date`, `clinic_id`, `provider_id`
- **ReviewRequest:** `id`, `patient_name`, `phone_email`, `status`, `sent_at`

### 6. Vendor Management
- **Vendor:** `id`, `name`, `category`, `performance_score`
- **VendorContact:** `id`, `vendor_id`, `name`, `email`, `phone`
- **Contract:** `id`, `vendor_id`, `value`, `start_date`, `renewal_date`, `document_url`
- **Invoice:** `id`, `vendor_id`, `amount`, `status`, `due_date`, `document_url`

### 7. Marketing Analytics (Aggregated Data)
- **AnalyticsSnapshot:** `id`, `date`, `website_visitors`, `leads`, `calls`, `form_submissions`, `conversion_rate`, `roi`

## Prisma Schema Example (Snippet)
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id        String   @id @default(uuid())
  email     String   @unique
  roleId    String
  role      Role     @relation(fields: [roleId], references: [id])
  createdAt DateTime @default(now())
}
// Further definitions to be added during implementation...
```
