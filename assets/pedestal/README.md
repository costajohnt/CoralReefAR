# Pedestal marker

`marker.svg` is a **placeholder**, not a production asset. It exists so
developers can print a quick paper target for local smoke testing without
commissioning real artwork.

## Characteristics a good marker needs

Image-target trackers (8th Wall, MindAR, WebXR image-tracking) lock onto
feature clusters — corners, edges, mid-tone gradients. They fail on:

- Repetitive or rotationally symmetric patterns (checkerboards, radial logos)
- Pure primary colors (CMOS sensors demosaic red/green/blue poorly)
- Glossy finishes (glare destroys features)
- Low resolution / bitmap artefacts

A good pedestal marker is:

- **Asymmetric** — so the tracker can recover orientation, not just position.
- **High contrast, mid-tone palette** — teal, coral, cream, deep blue over
  a dark or neutral base rather than pure RGB primaries.
- **Feature-dense** — many corners and fine details distributed across the
  image, not concentrated in one region.
- **Matte printed** — no gloss, no foil, no laminate.
- **~150–200 mm square** on the pedestal top, flat, level, well-lit.

## Swapping for production

1. Produce your artwork (Figma, Inkscape, Illustrator, a photograph of a
   reef, whatever). Export PNG at ≥2048×2048.
2. Commit it to `assets/pedestal/` (or private bin) as `marker.png`.
3. Feed it to your tracker. 8th Wall's image-target preprocessing now
   happens via the desktop app in
   [github.com/8thwall/8thwall/apps/](https://github.com/8thwall/8thwall)
   (the hosted dashboard is retired as of Feb 28, 2026). For MindAR,
   compile via the browser tool at
   <https://hiukim.github.io/mind-ar-js-doc/tools/compile> to produce
   a `.mind` file. Either way the physical print is what matters — the
   app doesn't ship the marker image itself in production.
4. Print matte on heavyweight paper, mount to the pedestal top.

## Testing this placeholder

You can print the SVG directly (Chrome → Print → Save as PDF), or rasterize:

```sh
# Requires rsvg-convert (librsvg), e.g. `brew install librsvg`
rsvg-convert -w 2048 -h 2048 assets/pedestal/marker.svg > /tmp/marker.png
```

Feed that PNG to your tracker's image-target pipeline, print it, and test.
If tracking is flaky, the most common fix is better lighting (diffuse,
overhead) rather than a different marker.
