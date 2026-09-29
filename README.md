# Universal DB

One shared PostgreSQL database for every Bookends Hospitality app. Each app
reads and writes the same outlets, brands, employees, users, vendors, and
recipes, instead of keeping its own copy.

> **Status:** planning. There is no schema or code yet. This README records the
> intent, the scope, and the decisions still open.

---

## Why

Every internal app runs on Postgres, and each one defines the same core
entities on its own:

| Entity | Defined separately in |
| --- | --- |
| Outlet / Location | OrderGenie, Shiftly, EmpDir, Kitchops, Instasuite, MISE, Shiftlyyy |
| Brand / Organization / Tenant | Shiftly, Booklet, Kitchops, Shiftlyyy, Instasuite |
| Employee / Staff | Niyukti, Shiftly, EmpDir, Kitchops, Shiftlyyy |
| User, Role, Permission | OrderGenie, Niyukti, EmpDir, Kitchops, Booklet, MISE, Shiftlyyy, Instasuite |
| Department, Designation, Position | EmpDir, Niyukti, Shiftlyyy |
| Shift, Attendance, Leave | Shiftly, EmpDir, Shiftlyyy |
| Vendor, Purchase Order, Inventory | OrderGenie, Kitchops |
| Recipe, Ingredient | Kitchops, Booklet, MISE, OrderGenie |
| Order / Sale | OrderGenie, Kitchops, Instasuite |
| Audit log | nearly all of them |

These copies have already drifted apart. The `Outlet` table alone looks like
this today:

- **OrderGenie** uses a `cuid` ID, stores the brand as free text, and keys on
  the Petpooja restaurant ID (`rid`).
- **Shiftly** uses a `uuid` ID, has a real `Brand` foreign key, and stores
  geofence coordinates for attendance punches.
- **EmpDir** uses a `cuid` ID, an outlet `code`, and belongs to a `Project`
  and a `Location`.
- **Instasuite** has outlets per business and matches them by name.

So adding a new outlet means entering it by hand in up to seven places, and
the apps cannot reliably tell whether two rows are the same outlet. Reports
that span apps (headcount against sales per outlet, for example) need manual
matching.

## Goals

1. **One source of truth** for shared entities. Create an outlet or onboard an
   employee once, and every app sees it.
2. **Stable IDs everywhere.** Every shared row gets one UUID that all apps use.
3. **External IDs mapped once.** Petpooja restaurant IDs, biometric punch IDs,
   and similar keys live in one mapping table.
4. **One login and one permission model** across apps, scoped by brand and
   outlet.
5. **Apps keep their own data.** Tables that only one app uses stay owned by
   that app.

## Non-goals

- Merging every app's feature tables into one schema.
- Rewriting the apps. They migrate one at a time (see [Migration plan](#migration-plan)).
- Replacing Petpooja as the POS. It stays the source for sales and inventory
  data, which gets synced in.

## Proposed layout

Each domain gets its own Postgres schema. Only this repo writes the shared
schemas' migrations.

```
core          organizations, brands, outlets, locations, departments, designations
identity      users, roles, permissions, user_roles, user_scopes (brand/outlet), refresh_tokens
people        employees, employment_history, assignments (employee ↔ outlet), documents
workforce     shifts, shift_templates, attendance, leave_types, leave_requests, holidays
catalog       items, recipes, recipe_ingredients, dishes, categories, units
procurement   vendors, vendor_items, purchase_orders, purchase_order_items, inventory
sales         orders, order_items, sales (synced from Petpooja)
integration   external_ids (petpooja rid, punch device ids, …), sync_logs
audit         audit_log (one table, written by every app)

app_<name>    tables only one app uses (for example app_niyukti, app_instasuite)
```

### Conventions

- **Primary keys:** `uuid` (`gen_random_uuid()`). No `cuid`, no serial integers
  on shared tables.
- **Naming:** `snake_case` tables and columns, plural table names.
- **Timestamps:** every table has `created_at` and `updated_at` as
  `timestamptz`.
- **Deletes:** shared entities are soft-deleted (`status` or `archived_at`)
  so other apps' foreign keys never break.
- **Access:** each app connects with its own database role. It gets read access
  to the shared schemas it needs, write access only where it is the owner, and
  full access to its own `app_<name>` schema.
- **Ownership:** each shared table has one owning app that handles writes (for
  example, Niyukti owns `people.employees`). Other apps read it.

## Migration plan

Apps move over one at a time, starting with the entities that change least.

1. **Stand up `core` and `integration`.** Load outlets and brands from the
   existing apps, reconcile duplicates by hand, and record each app's old ID in
   `integration.external_ids`.
2. **Point one app at `core`.** OrderGenie is a good first candidate because
   its outlets already key on the Petpooja `rid`.
3. **Add `identity`** so every app uses the same users and outlet/brand scopes.
4. **Add `people` and `workforce`.** Niyukti, EmpDir, and Shiftly share one
   employee record.
5. **Add `catalog` and `procurement`.** Recipes and vendors are shared across
   Kitchops, Booklet, MISE, and OrderGenie.
6. **Retire the duplicate tables** in each app once nothing reads them.

## Open decisions

- [ ] **Hosting:** Supabase, Railway, or self-managed Postgres. Several apps
      already use Supabase auth and RLS, and others use Railway.
- [ ] **Migration tool:** Prisma (most apps already use it), plain SQL
      migrations, or another tool.
- [ ] **Auth:** does `identity` replace each app's login, or sit behind
      Supabase Auth or a separate SSO?
- [ ] **Tenancy:** is there one organization (Bookends), or do Instasuite and
      Shiftlyyy need real multi-tenant isolation?
- [ ] **Access pattern:** do apps connect to the database directly, or through
      a shared API service?
- [ ] **What this `dashboard` repo holds:** the schema only, or also an admin
      UI for managing the master data.

## Repository layout (planned)

```
dashboard/
├── README.md
├── schema/          # migrations for the shared schemas
├── seed/            # scripts that import outlets, brands, and employees from existing apps
├── docs/            # entity ownership, ID mapping, and per-app migration notes
└── .env.example     # DATABASE_URL and the per-app role credentials
```
