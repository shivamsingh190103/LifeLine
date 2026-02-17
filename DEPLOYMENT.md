# BloodBank Deployment Guide (Vercel + Supabase)

## Prerequisites

- GitHub repository with this project
- Supabase project (PostgreSQL)
- Vercel account

## Step 1: Prepare Supabase

1. Create a project in [Supabase](https://supabase.com).
2. Open `Project Settings -> Database -> Connection string`.
3. Copy your PostgreSQL URI (pooler URI recommended for deployment).
4. Save this URI for Vercel `DATABASE_URL`.

## Step 2: Ensure Schema Exists

Use one of these methods:

- Method A (from local machine):
  1. Set `.env` with your Supabase `DATABASE_URL` and `DATABASE_SSL=true`
  2. Run: `npm install`
  3. Run: `npm run setup`

- Method B (Supabase SQL Editor):
  1. Open SQL Editor in Supabase
  2. Copy content of `database/schema.sql`
  3. Run it

## Step 3: Push Code to GitHub

```bash
git add .
git commit -m "Supabase-ready deployment setup"
git push origin main
```

## Step 4: Import Project in Vercel

1. Go to Vercel dashboard
2. Click `Add New Project`
3. Import this GitHub repository
4. Keep framework preset as `Other`
5. Deploy once

## Step 5: Configure Environment Variables in Vercel

In `Project -> Settings -> Environment Variables`, add:

- `DATABASE_URL` = Supabase PostgreSQL URI
- `DATABASE_SSL` = `true`
- `NODE_ENV` = `production`
- `CORS_ORIGIN` = `https://<your-vercel-domain>` (recommended)
- `APP_BASE_URL` = `https://<your-vercel-domain>`
- `EMAIL_VERIFICATION_TOKEN_TTL_HOURS` = `24` (optional)
- `ADMIN_API_KEY` = strong random secret (required for authority approval endpoints)
- `REQUIRE_AUTHORITY_FOR_DONATION_COMPLETION` = `false` (set `true` for strict hospital/doctor-only completion)

For forgot-password, email-verification, and contact-form emails, also add SMTP variables:
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_SECURE`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`
- `CONTACT_RECEIVER_EMAIL` (where contact form messages should be delivered)

Then redeploy.

## Step 6: Verify Deployment

1. Open `https://<your-vercel-domain>/api/health`
2. Confirm it returns:
   - `success: true`
   - `database: "connected"`
3. Test user registration and login pages
4. Test dashboard API calls

## Common Failures and Fixes

- `Database is currently unavailable`
  - Wrong `DATABASE_URL`
  - `DATABASE_SSL` missing/false
  - Schema not created

- Static UI broken (CSS missing)
  - Confirm `vercel.json` is committed
  - Redeploy after pushing all assets

- API errors after deploy
  - Check Vercel logs
  - Check Supabase logs

## Useful Commands

```bash
# Local run
npm run dev

# Production-like local run
npm start

# Re-apply DB schema
npm run setup
```
