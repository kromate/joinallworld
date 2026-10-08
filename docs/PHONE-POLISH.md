# Phone UI polish

8 October 2026. Part of the phased parity delivery in PARITY-DELIVERY.md.

The phone keeps its existing app routes, badges, wallpaper preferences, notifications, keyboard navigation, safe areas and fixed dock. The home screen now displays one category per swipeable page: Life, Money, People and City. Page buttons scroll by the page width rather than a child element's offset relative to the device. Their hit areas no longer overlap, so tapping a dot selects the labelled page.

The 42 original app illustrations use filled, layered forms, color and baked-in shading. They replace the repeated information glyphs on My land, My street, Story scenes and Capture. These are raster app artworks, not enlarged toolbar glyphs. The ordinary small glyphs remain suitable for navigation and app headers. Missing header glyphs are also supplied.

One 896×768 WebP atlas holds all artwork. It is referenced only by the Phone component and fetched when the phone opens. There are no icon fonts, third-party asset requests, new application dependencies, animated light effects or per-icon blur filters. The atlas is about 82 KiB. Its original source is `scripts/phone/build-icons.mjs`; regenerate with `node scripts/phone/build-icons.mjs /path/to/an/installed/sharp`. The checked-in atlas means normal builds do not need sharp.

The default Lagoon wallpaper now uses a quiet navy/teal palette. Harmattan, Ankara and Palm remain selectable, with quieter colors. Labels have consistent sizing; category pages keep the lower apps clear of the dock. The dock and notification cards use restrained translucency; the clock, spacing and icon proportions follow the handset shape.

## Reference research

- [Apple's design overview](https://www.apple.com/newsroom/2025/06/apple-introduces-a-delightful-and-elegant-new-software-design/) informed layered icon artwork, a translucent dock and concentric rounded controls.
- [Samsung's home-screen guidance](https://www.samsung.com/ca/support/mobile-devices/changes-to-the-home-screen-on-the-samsung-galaxy-devices/) informed consistent icon/label sizing and alignment.

No Apple or Samsung icon assets were copied. The designs and generator are original Allworld work.

## Verification

Existing phone/model checks: 27/27 passed. A registry scan found artwork for all 39 literal registered phone IDs, plus the built-in Help/Community and Admin entries. Desktop and 390×844 browser views were inspected. The first review caught and corrected category-page scrolling; final confirmation and download-budget results are recorded in the delivery tracker. This is not a physical-device thermal benchmark.
