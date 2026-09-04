# Database & environment setup

TruckGo runs on **PostgreSQL in every environment, including local development**.

SQLite was fine while this was a prototype, but it differs from production in ways that hide
bugs until they cost you: no native enums, no `Decimal`, one writer at a time, different
NULL and collation behaviour. Developing against the same engine you deploy on is the point.

---

## 1. The environments

| | Local dev | Staging | Production |
|---|---|---|---|
| Where | Postgres on your laptop | Managed Postgres | Managed Postgres |
| Database | `truckgo_dev` | `truckgo_staging` | `truckgo_prod` |
| Backend | `localhost:3001` | Small always-on instance | Always-on, scaled |
| SMS | mock (console) | MSG91 test | MSG91 live |
| KYC | mock | Surepass sandbox | Surepass live |
| Payments | mock | Razorpay **test** keys | Razorpay **live** keys |
| Maps | OSRM (free) | Google key | Google key |
| JWT secrets | dev values | **unique** | **unique** |

**The separation that actually matters is the database.** Not naming conventions, not
discipline — the fact that your laptop has no network route to the production database is
what stops a bad migration or a stray `deleteMany` from touching real bookings.

**Never** put a production `DATABASE_URL` in a local `.env`, even temporarily.

---

## 2. Local setup (one time)

PostgreSQL 16 is already installed and running on this machine as the
`postgresql-x64-16` service.

Open **PowerShell** and run these. You will be prompted for the `postgres` superuser
password you chose when installing PostgreSQL:

```powershell
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -c "CREATE ROLE truckgo WITH LOGIN PASSWORD 'pick-a-strong-dev-password';"
```

```powershell
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -c "CREATE DATABASE truckgo_dev OWNER truckgo;"
```

Then put the matching URL in `backend/.env` (copy `backend/.env.example` first):

```
DATABASE_URL="postgresql://truckgo:pick-a-strong-dev-password@localhost:5432/truckgo_dev?schema=public"
```

Generate real secrets — a different value for each of the three, and different again per
environment:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Create the tables:

```bash
cd backend && npx prisma migrate dev --name init_postgres
```

> A dedicated `truckgo` role rather than `postgres` is deliberate: the app should not be
> connecting as a superuser that can drop any database on the box.

---

## 3. Production hosting

Your laptop cannot be the database — it would need to be online permanently, has no
backups, no failover, and no way to scale. Two workable paths:

### Managed Postgres

| Option | Good for | Notes |
|---|---|---|
| **Neon** | Starting out | Generous free tier, scales to zero, branching for staging. Easiest path |
| **AWS RDS** | Later, at scale | Full control, automated backups, read replicas, VPC isolation. More ops work |
| **Supabase** | Starting out | Postgres plus auth/storage you may not need |

**Pick the Mumbai region (`ap-south-1`)** whichever you choose. Your drivers and shippers
are in India; every millisecond of database latency is added to every request they make.

Recommendation: **start on Neon, move to RDS when scale or compliance demands it.** The
connection string is the only thing that changes — that is exactly why the schema is
Postgres now rather than later.

### Backend hosting

The API also needs somewhere always-on. **Railway** or **Render** are the least work
(push to deploy, managed TLS, environment variables in a dashboard). The original TruckGo
backend ran on Railway, so it is proven for this workload.

At minimum, production needs:

- Automated daily backups with a tested restore — an untested backup is not a backup
- `NODE_ENV=production` so the fail-fast secret checks engage
- `CORS_ORIGINS` set to your real domains
- Migrations run via `prisma migrate deploy` (never `migrate dev`, which can reset data)

---

## 4. Deploying a schema change safely

```bash
# 1. Develop locally — this can and will reset your local database.
npx prisma migrate dev --name add_something

# 2. Commit the generated SQL in prisma/migrations/ and review it like any other code.
#    Look specifically for DROP COLUMN and NOT NULL on existing tables.

# 3. Apply to staging, on a copy of production-shaped data.
DATABASE_URL=$STAGING_URL npx prisma migrate deploy

# 4. Only then production.
DATABASE_URL=$PROD_URL npx prisma migrate deploy
```

`migrate deploy` only applies committed migrations and never resets. `migrate dev` is a
development-only command — running it against production can drop the database.
