# Images to give Codex

Use these supplied/derived images together with the geometry files. Exact diagrams were produced programmatically; no AI-generated land layout is used.

| Image | Coding purpose | Accuracy boundary |
|---|---|---|
| `public/assets/colony-poster.png` | Project name, existing identity, overall colony presentation, advertised amenity references | A marketing source; does not establish current approvals, dimensions, inventory status, or completion |
| `public/assets/survey-plan-north.png` | Readable source plan with dimensions, roads, plot labels, orientation | A rendering of the supplied PDF, not independent verification that this is the latest approved plan |
| `public/assets/geographic-layout.svg` | Resolution-independent shape/road/plot-number reference | Derived geometry; draft cells and number matches need review |
| `public/assets/geographic-layout.png` | Easy visual attachment for Codex | Same derived data as SVG; image colours do not express real availability |
| `public/assets/plot-dimensions-example.png` | How a selected cell should show separate edge lengths | B26 example with map-derived estimates; do not copy these values to other plots |

## Rules for using images

- Build interactive shapes from data, not hundreds of absolutely positioned buttons pasted over the poster.
- Do not use a single raster poster as the entire website.
- Do not interpret green, blue, grey, or gold source fills as sold/booked/available.
- Preserve the north orientation and site geometry unless the owner supplies a corrected source.
- Make source drawings zoomable; never shrink the only dimensions beyond readability.
- Keep SVG vector geometry as the crisp interactive layer. PNGs support reference, original-plan viewing, and fallbacks.
- No real photographs of completed amenities have been supplied. The drawn fountain, landscaping, temple, and club are layout features, not photographs proving completion.
- Attach the PDF/KML/GeoJSON alongside the images so Codex has geometry and provenance rather than guessing shapes from a screenshot.

## Visual direction

A calm deep-green and ivory interface, restrained gold selection, readable numbers, unobstructed map, structured detail panel, and large touch controls. The included React app is the executable UI reference. The exact colony geometry is more important than copying decorative rendering from the promotional poster.
