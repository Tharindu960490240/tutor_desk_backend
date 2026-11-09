# TutorDesk – API

Node + Express + PostgreSQL. On Vercel use the **Express** framework preset: Vercel runs `src/app.js` directly. `dev.js` is only for running on your computer.

```bash
# create .env (see .env.example)
npm install
npm run dev       # http://localhost:4000
```

Check it is working: open `/api/health`. It shows whether the database is connected and which settings are present.
