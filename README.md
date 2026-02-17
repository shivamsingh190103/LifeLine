# BloodBank Full-Stack (Supabase + Vercel Ready)

A blood donation platform that connects donors with recipients, with location-aware matching, SSE emergency alerts, and secure authentication.

## Features

- User registration/login with bcrypt password hashing
- Email verification flow (when SMTP is configured)
- Forgot password flow with secure email reset tokens
- Server-side phone validation (10-digit format)
- Disposable-email domain blocking
- Auto location sync on auth/dashboard visit (with geolocation permission)
- Search donors and receivers by location
- Gamified "Superheroes of Life" active donor leaderboard
- In-app rating and feedback collection with summary analytics
- Notification center for app events and emergency alerts
- Blood request and donation workflows
- Inventory tracking and contact management
- Nearby donor matching (Haversine formula)
- Live emergency alerts with Server-Sent Events (SSE)
- Redis-backed cache support (with in-memory fallback)
- PostgreSQL/Supabase backend compatibility

## Tech Stack

- Frontend: HTML, CSS, Vanilla JavaScript
- Backend: Node.js + Express
- Database: PostgreSQL (Supabase supported)
- Optional cache: Redis

## 1) Run Locally in VS Code (Step by Step)

1. Install prerequisites:
   - Node.js 18+ and npm
   - VS Code
   - A PostgreSQL database (Supabase or local Postgres)

2. Open project in VS Code:
   - `File -> Open Folder...`
   - Select this folder: `BloodBank-main-4`

3. Install dependencies in VS Code terminal:
   - `npm install`

4. Create env file:
   - Copy `.env.example` to `.env`
   - Fill values (Supabase recommended):

```env
DATABASE_URL=postgresql://postgres.<project-ref>:<password>@<host>:5432/postgres
DATABASE_SSL=true

# Optional fallback if DATABASE_URL is empty
DB_HOST=localhost
DB_USER=postgres
DB_PASSWORD=
DB_NAME=bloodbank_db
DB_PORT=5432

DB_CONNECTION_LIMIT=10
DB_CONNECT_TIMEOUT_MS=10000
DB_IDLE_TIMEOUT_MS=30000
AUTH_RATE_LIMIT_WINDOW_MS=900000
AUTH_RATE_LIMIT_MAX=30
PASSWORD_RESET_TOKEN_TTL_MINUTES=30
EMAIL_VERIFICATION_TOKEN_TTL_HOURS=24
CORS_ORIGIN=
APP_BASE_URL=http://localhost:3000
DISPOSABLE_EMAIL_DOMAINS=

# Required for forgot password + email verification + contact-form email notifications
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
CONTACT_RECEIVER_EMAIL=

DONOR_SEARCH_CACHE_TTL_SECONDS=120
REDIS_URL=
PORT=3000
```

5. Initialize database schema:
   - `npm run setup`

6. Start app:
   - Development: `npm run dev`
   - Production mode locally: `npm start`

7. Open in browser:
   - Frontend: `http://localhost:3000`
   - Health check: `http://localhost:3000/api/health`

## 2) Supabase Setup (Step by Step)

1. Create project in [Supabase](https://supabase.com).
2. Go to `Project Settings -> Database -> Connection string`.
3. Copy PostgreSQL URI (prefer pooler URI for deployments).
4. Put it in `.env` as `DATABASE_URL`.
5. Set `DATABASE_SSL=true`.
6. Run schema setup from project terminal:
   - `npm run setup`
7. Verify:
   - `GET /api/health` should show `database: "connected"`.

## 3) Deploy to Vercel from GitHub (Step by Step)

1. Push your latest code to GitHub.

2. In Vercel:
   - Click `Add New Project`
   - Import your GitHub repository

3. Configure project:
   - Framework preset: `Other`
   - Root directory: repository root

4. Add environment variables in Vercel Project Settings:
   - `DATABASE_URL` = your Supabase Postgres URI
   - `DATABASE_SSL` = `true`
   - `NODE_ENV` = `production`
   - `CORS_ORIGIN` = your Vercel domain (optional but recommended)
   - `PORT` is optional on Vercel

5. Deploy.

6. After first deploy:
   - If tables are missing, run schema once against Supabase:
     - Option A: run `npm run setup` locally with same `DATABASE_URL`
     - Option B: paste `database/schema.sql` in Supabase SQL Editor and run

7. Verify deployment:
   - Open `https://<your-vercel-domain>/api/health`
   - Test register/login and dashboard flows

## API Modules

- `/api/auth`
- `/api/blood-requests`
- `/api/donations`
- `/api/contact`
- `/api/inventory`
- `/api/matching`
- `/api/alerts`

## Troubleshooting

- `Database is currently unavailable`:
  - Check `DATABASE_URL`
  - Ensure `DATABASE_SSL=true` for Supabase
  - Confirm DB password/user/host are correct
  - Confirm schema exists (`npm run setup`)

- CSS/animation not loading on deployment:
  - Confirm `vercel.json` includes static assets (`*.css`, `Images/**`, `video/**`)
  - Redeploy after commit

- Nearby donor matching returns none:
  - Ensure users have `latitude` and `longitude`
  - Ensure donor has `is_donor=true`

## Scripts

- `npm start` -> start server
- `npm run dev` -> nodemon server
- `npm run setup` -> apply database schema
- `npm test` -> syntax checks
