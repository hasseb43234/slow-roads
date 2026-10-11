# Putting Calm Road online

Calm Road is a static website (index.html, css/, js/). It needs no server code or build step.
The only outside file is three.js, loaded from cdnjs, so visitors need an internet connection.

## Fastest: Netlify Drop (about 1 minute, free)
1. Go to https://app.netlify.com/drop
2. Drag this whole `calm-road` folder (or `calm-road.zip`) onto the page.
3. You get a live https link straight away. Rename it under Site settings > Change site name.

## GitHub Pages (free, good for a permanent link)
1. Create a new public repository on GitHub and upload the contents of this folder (index.html at the top level).
2. Settings > Pages > Source: "Deploy from a branch", branch `main`, folder `/ (root)`.
3. After a minute the game is at https://YOUR-NAME.github.io/REPO-NAME/

## Vercel (recommended for speed)
1. Sign in at https://vercel.com with GitHub, press Add New > Project and pick this repository.
2. Framework Preset: Other. Leave the build command and output directory empty. Deploy.
3. `vercel.json` already sets security headers and caching, so nothing else is needed.
Every push to `main` redeploys automatically.

## Cloudflare Pages
Create a project, connect the repo, leave the build command empty, output directory `/`.

## Custom domain
Buy a domain, then add it in the host's Domains settings and follow its DNS instructions. HTTPS is automatic.

## Before you share it
- Test on a phone and a laptop. Sound starts after the first click or key press (browser rule).
- Your music choice and volume are saved per browser (localStorage).

## Speed notes
- `vercel.json`: HTML is always revalidated; `/css`, `/js` and `/img` are cached for a year (`immutable`) because their links carry a version, `?v=3`.
- `sw.js` is a service worker: pages are fetched fresh, versioned files and three.js come from the cache, so repeat visits start instantly and even work offline.
  **Every time you change css/js/img files, run `node bump.cjs 4` (then 5, 6, ...)** before pushing. It updates the `?v=` numbers in `index.html` and the version in `sw.js` so nobody sees a stale mix of old and new files.
  The service worker is skipped on localhost; add `?sw=1` to the URL to test it locally.
- The game lowers its resolution, then turns shadows off, automatically if a device struggles, and climbs back up when it has headroom.
