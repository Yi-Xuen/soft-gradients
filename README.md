# Soft Gradients

Turn a nature photo into a soft, fluid gradient. Pick a photo from the built-in Unsplash wall (or upload your own), tweak the colors, smoothness and warp, and export a PNG named after the palette, e.g. `Gradient - Dune Ember.png`.

No build step and no dependencies. Serve the folder and open it in a browser:

```bash
python3 -m http.server 8765
```

Then visit <http://localhost:8765>.

## How it works

- The photo is reduced to a few dominant colors (k-means in OKLab) and a coarse 6×8 grid of cell colors.
- A WebGL shader blends the grid smoothly and bends it with simplex-noise warping, plus a little grain to avoid banding.
- The title is generated from the palette's lightest and darkest colors.

## Unsplash search (optional)

The photo wall works out of the box. For live search, click **Key** and paste your own [Unsplash](https://unsplash.com/developers) Access Key. It is stored only in your browser's local storage.

Photos are loaded from Unsplash.
