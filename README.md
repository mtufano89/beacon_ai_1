\# Beacon AI



Beacon AI is an AI-powered website analysis and lead generation tool built for Shoreline Dev Co.



\## Project Structure



\- `server.js`  

&nbsp; Node.js + Express backend  

&nbsp; Handles website analysis, caching, email validation, and lead storage via Supabase.



\- `beacon-ai-ui/`  

&nbsp; Vite + React frontend  

&nbsp; Provides the user interface for running website scans and viewing results.



\## Requirements



\- Node.js 18+

\- npm

\- Supabase project with:

&nbsp; - `beacon\_ai` table (reports)

&nbsp; - `beacon\_ai\_leads` table (leads)



\## Running the Backend



From the project root:







Backend runs at: http://localhost:3001









\## Running the Frontend



In a separate terminal:



cd beacon-ai-ui

npm install

npm run dev







Frontend runs at: http://localhost:5173





\## Environment Variables



Create a `.env` file in the project root with:



SUPABASE\_URL=https://gvouhkmbhtbsbzkofhef.supabase.co

SUPABASE\_SERVICE\_ROLE\_KEY=sb\_secret\_YlMujhvCVgeWRYk\_qbpVww\_eVM60x-U





\## Status



\- Backend: stable

\- Frontend: stable

\- Lead saving: enabled

\- Email validation: enabled

\- Deployment: pending









