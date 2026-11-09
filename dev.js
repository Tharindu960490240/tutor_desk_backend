// Local development only: `npm run dev`. (On Vercel, src/app.js is used directly – this file is never run there.)
import app from "./src/app.js";
const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`TutorDesk API on http://localhost:${port}`));
