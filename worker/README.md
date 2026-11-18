# Unsplash proxy

Unsplash's API guidelines say the Access Key must stay private and that visitors shouldn't need their own
developer account. This Worker holds the key and forwards two calls for the site: photo search and download tracking.

## Deploy

```bash
cd worker
npx wrangler login
npx wrangler deploy
npx wrangler secret put UNSPLASH_ACCESS_KEY   # paste your Unsplash Access Key when prompted
```

Wrangler prints the Worker's URL (like `https://soft-gradients-proxy.<you>.workers.dev`).
Put it in `PROXY` near the top of the Unsplash section of `app.js`, then commit and push.
Until `PROXY` is set, the search box is hidden and the wall shows the curated photos only.
