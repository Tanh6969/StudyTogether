# StudyTogether frontend

## Run locally

```sh
npm install
npm run dev
```

Unless all three real-service settings are configured, the frontend automatically uses local
demo data. Set `VITE_USE_MOCK=true` in `.env` to force demo mode.

Demo sign-in:

- Email: `minhanh@study.local`
- Password: `123456`

The demo includes sample study groups, members, channels, rooms, notifications, tasks, and
roadmaps. Changes are stored in browser `localStorage`; run `window.__resetMockDb()` in the
browser console to restore the seed data.

To use the real services instead, configure `VITE_API_BASE_URL`, `VITE_SUPABASE_URL`, and
`VITE_SUPABASE_ANON_KEY` as documented in `.env.example`.

## Supabase registration without email confirmation

To let users register and enter the app without receiving a confirmation email, open the
Supabase Dashboard and go to **Authentication → Sign In / Providers → Email**. Turn off
**Confirm email** and save the provider settings. New signups will then receive a session
immediately; the app keeps using email as the account identifier, but users do not need to
prove they own that address. Incorrect email addresses cannot receive password-reset emails.

Accounts created earlier while confirmation was required may still need to be confirmed by
an administrator before those users can sign in.

## Checks

```sh
npm test
npm run build
```
