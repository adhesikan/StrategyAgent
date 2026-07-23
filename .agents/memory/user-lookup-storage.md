---
name: User lookup — use authStorage, not storage
description: storage.getUser in server/storage.ts is an in-memory Map stub; real users live in the DB via authStorage.
---
**Rule:** To fetch a real user (role, email) by id on the server, use `authStorage.getUser` from `server/replit_integrations/auth/storage.ts`. Do NOT use `storage.getUser` from `server/storage.ts` — that method is part of a legacy in-memory MemStorage and always returns undefined for real registered users.

**Why:** A Twelve Data access gate silently denied admins because `storage.getUser(userId)` returned undefined (in-memory map, empty at runtime), while the actual users table is only reachable via authStorage.

**How to apply:** Any server-side role/entitlement check keyed on `req.session.userId` must load the user through authStorage (or a direct Drizzle query on the `users` table).
