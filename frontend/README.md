# StudyTogether frontend

## Run locally

```sh
npm install
npm run dev
```

When no backend or Supabase settings are configured, the frontend automatically uses local
demo data. You can also enable it explicitly with `VITE_USE_MOCK=true` in `.env`.

Demo sign-in:

- Email: `minhanh@study.local`
- Password: `123456`

The demo includes sample study groups, members, channels, rooms, notifications, tasks, and
roadmaps. Changes are stored in browser `localStorage`; run `window.__resetMockDb()` in the
browser console to restore the seed data.

To use the real services instead, configure `VITE_API_BASE_URL`, `VITE_SUPABASE_URL`, and
`VITE_SUPABASE_ANON_KEY` as documented in `.env.example`.

## Checks

```sh
npm test
npm run build
```
