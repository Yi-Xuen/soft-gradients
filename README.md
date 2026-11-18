# Fluid Hues

Turn a photo into a soft, fluid gradient. Pick from a wall of landscape photos (or upload your own), tweak it, and export a PNG.

**[Try it live →](https://fluid-hue.vercel.app)**

<!-- Suggested: one screenshot or short GIF of the wall → editor transition -->

## Design decisions

- **Gradients that feel organic, not linear.** Colours come from the photo itself, and the shape is warped so it reads like light through fog rather than a stripe.
- **A photo wall instead of an upload form.** Most people have no image on hand, so the first screen is a draggable, circular wall of photos that keeps loading as you explore, with search for anything else.
- **One decision at a time.** Choose a photo, then adjust. The transitions between the two steps are choreographed and respect reduced-motion settings.
- **Works with a thumb.** Phone layouts keep the photo and gradient side by side, every control is at least 44px, and nothing re-renders when the browser bar collapses.
- **Names, not hex codes alone.** Each palette gets a generated name ("Straw Olive", "Cloud Moss") that is baked into the exported image.

## Under the hood

- Palette extraction with k-means in OKLab, so colours are chosen by how they look, not by their RGB values
- A WebGL fragment shader with bicubic sampling, simplex-noise domain warping and grain to prevent banding
- No framework or build step: plain HTML, CSS and JavaScript
- A small Cloudflare Worker proxies Unsplash search, keeping the API key off the client and caching results
- Follows Unsplash's API guidelines: hotlinked images, photographer credit on every photo, and download tracking

Photos from [Unsplash](https://unsplash.com/?utm_source=fluid_hues&utm_medium=referral).
