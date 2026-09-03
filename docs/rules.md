# MSBI Marketing Operations CRM - Backend Coding Rules & Standards

## 1. Project Structure
Maintain a modular structure based on domain features (Domain-Driven Design concepts):
```
/backend
  /src
    /modules
      /campaigns
        campaigns.controller.ts
        campaigns.service.ts
        campaigns.schema.ts
        campaigns.routes.ts
      /budget
      /analytics
    /plugins
      db.ts (Prisma setup)
      auth.ts (Better Auth setup)
    /utils
    app.ts
    server.ts
```

## 2. API Design & Fastify Rules
- **Encapsulation:** Use Fastify plugins to encapsulate routes and middleware securely.
- **Validation:** ALWAYS use JSON Schema (via TypeBox or Zod) in route definitions to validate incoming `body`, `querystring`, and `params`. Fastify will automatically reject invalid requests.
- **Standard Responses:** Use a consistent JSON response format:
  ```json
  {
    "success": true,
    "data": { ... },
    "error": null
  }
  ```

## 3. Database & Prisma Rules
- **Migrations:** Never alter the database manually. Always modify `schema.prisma` and run `npx prisma migrate dev`.
- **Soft Deletes:** For critical data (Campaigns, Budgets, Vendors), implement a soft delete (`is_deleted` boolean) instead of hard deleting rows.
- **Transactions:** Use `$transaction` when performing multi-step inserts (e.g., creating a campaign and its initial tasks simultaneously).

## 4. Error Handling
- Never expose raw database errors or stack traces to the client.
- Use a global Fastify error handler to catch exceptions and format them properly.
- Use appropriate HTTP status codes: `400` for bad requests, `401` for unauthorized, `403` for forbidden, `404` for not found, and `500` for internal server errors.

## 5. TypeScript Standards
- Strictly type all variables, function arguments, and return types.
- Avoid using `any`; use `unknown` if the type is truly dynamic.
- Enable `strict: true` in `tsconfig.json`.
