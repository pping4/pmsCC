# PMS Service Apartment — Setup Guide

## Prerequisites

- Node.js 18+
- PostgreSQL database (or Supabase free tier)
- npm or pnpm

## Quick Start

### 1. Install Dependencies

```bash
cd pms-next
npm install --legacy-peer-deps
```

### 2. Configure Environment

Copy `.env.example` to `.env.local` and fill in your values:

```bash
cp .env.example .env.local
```

Edit `.env.local`:

```env
DATABASE_URL="postgresql://user:password@host:5432/dbname?schema=public"
NEXTAUTH_SECRET="your-random-secret-here"
NEXTAUTH_URL="http://localhost:3000"
```

Generate NEXTAUTH_SECRET: `openssl rand -base64 32`

### 3. Set Up Database

```bash
npx prisma generate
npx prisma migrate dev --name init
npm run db:seed
```

### 4. Start Development Server

```bash
npm run dev
```

Open http://localhost:3000

### Default Login

| Role  | Email         | Password |
|-------|---------------|----------|
| Admin | admin@pms.com | admin123 |
| Staff | staff@pms.com | staff123 |

---

## Database Options

| Option | Cost/Month | Notes |
|--------|-----------|-------|
| Supabase Free | 0 THB | 500MB DB |
| Supabase Pro | ~1,500 THB | 8GB DB |
| Railway | ~800 THB | Includes PostgreSQL |
| VPS (DigitalOcean) | ~500 THB | Full control |

Supabase (https://supabase.com) is recommended for quick setup.

---

## Features

- 48 rooms across floors 2-7
- Room types: STD, SUP, DLX, STE  
- Booking sources: Direct, Walk-in, Booking.com, Agoda, Airbnb, Traveloka, Expat
- TM30 immigration compliance with automatic alerts
- VAT 7%: included/excluded/no-tax modes
- Bilingual Thai + English
- Mobile-first responsive design
- Roles: Admin, Manager, Staff
