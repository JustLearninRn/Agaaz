# AGAAZ 2k26 – Mr & Miss Fresher Poll (Netlify)

## Deploy
1. Push this folder to a GitHub repo and "Import project" on Netlify
   (or run `npm i -g netlify-cli && npm install && netlify deploy --prod`).
   Build settings are already in netlify.toml (no build command needed).
2. Netlify dashboard → Site configuration → Environment variables → add
   `ADMIN_PASSWORD` = your secret password (scope: Functions). Then redeploy.
3. Voters: https://yoursite.netlify.app/   ·   Admin: https://yoursite.netlify.app/admin
4. Make a QR code of the main URL (not /admin) and print it.

Data (votes, contestants, photos) is stored in Netlify Blobs – no database setup needed.
Do NOT drag-and-drop deploy only the public folder: the function needs the full project (git or CLI deploy).
