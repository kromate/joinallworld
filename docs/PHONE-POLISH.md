# Phone UI polish

8 October 2026. Part of the phased parity delivery in PARITY-DELIVERY.md.

The phone keeps its existing app routes, badges, wallpaper preferences, notifications, keyboard navigation, safe areas and fixed dock. The home screen now displays one category per swipeable page: Life, Money, People and City. Page buttons scroll by the page width rather than a child element's offset relative to the device. Their hit areas no longer overlap, so tapping a dot selects the labelled page.

The 42 app icons are actual raster renders of sculpted 3D objects, with volume, studio lighting, contact shadows, glossy ceramic, leather and metal materials. They replace the earlier illustrated artwork and repeated information glyphs. Small navigation glyphs remain separate from the app artwork.

One 1355×1161 WebP atlas holds the full set (212,876 bytes). It loads with the phone, with no runtime 3D scene, animation loop, external asset request or new application dependency. CSS samples measured cell boundaries to prevent neighboring icons bleeding into tiles. The earlier SVG drawing generator was removed.

Generated with the built-in image generation tool on 8 October 2026. Prompt: one exact 7×6 atlas of 42 tactile rendered 3D phone icons, consistent slightly elevated three-quarter camera, ceramic/silicone/metal materials, studio highlights and contact shadows, solid full-cell colored backgrounds, no labels, no flat/vector artwork. Subjects follow the row-major `PHONE_ART` registry; Ride is a yellow Lagos minibus. The generated PNG was encoded as WebP at quality 86 without changing its composition. The production asset is `src/ui/phone/app-icons.webp`.

The default Lagoon wallpaper now uses a quiet navy/teal palette. Harmattan, Ankara and Palm remain selectable, with quieter colors. Labels have consistent sizing; category pages keep the lower apps clear of the dock. The dock and notification cards use restrained translucency; the clock, spacing and icon proportions follow the handset shape.

## Reference research

- [Apple's design overview](https://www.apple.com/newsroom/2025/06/apple-introduces-a-delightful-and-elegant-new-software-design/) informed layered icon artwork, a translucent dock and concentric rounded controls.
- [Samsung's home-screen guidance](https://www.samsung.com/ca/support/mobile-devices/changes-to-the-home-screen-on-the-samsung-galaxy-devices/) informed consistent icon/label sizing and alignment.

No Apple or Samsung icon assets were copied. The artwork was generated for Allworld; no third-party icon pack is used.

## Verification

Existing phone/model checks: 27/27 passed. A registry scan found artwork for all 39 literal registered phone IDs, plus the built-in Help/Community and Admin entries. Desktop and 390×844 browser views were inspected. The first review caught and corrected category-page scrolling; final confirmation and download-budget results are recorded in the delivery tracker. This is not a physical-device thermal benchmark.
