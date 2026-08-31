# QR and PWA architecture

## Canonical branch URL

Every QR encodes exactly:

```text
https://welcome.zarraqai.com/c/{branchSlug}
```

The slug is globally unique, lowercase, and canonical. The encoder receives this URL string only: no tracking parameters, tenant ids, visitor ids, tokens, redirects, or embedded metadata. Changing a slug invalidates previously printed QR destinations, so the admin UI must warn before such a change.

## QR generation

Generate exports on the server from the canonical URL using a mature, pinned QR library. One shared configuration produces:

- SVG: vector output with an explicit white background and safe `viewBox` for professional printing.
- PNG: at least 2048×2048; optionally 4096×4096 for large-format export.

Recommended encoding configuration:

- black modules on a pure white background;
- error correction `Q` (or `H` only if actual decode/print testing shows no density problem);
- quiet zone at least 4 modules, preferably 8 modules for exposed physical signage;
- integer module scaling for PNG, without interpolation/blur;
- no gradients, rounded distortion, decorative cutouts, or inverted colors;
- no center logo by default. A future optional logo requires its own decode and print tests.

The output can be generated on demand and cached by branch slug/configuration; no QR asset table is needed. Protected admin routes expose:

- **QR الخاص بالفرع**
- **تحميل SVG**
- **تحميل PNG**
- **فتح الرابط**

The public URL itself remains public; download administration and branch configuration require `COFFEE_ADMIN` membership.

## QR validation plan

Phase implementation must test:

1. The encoded text equals the exact canonical URL.
2. An independent decoder reads generated SVG-rasterized and PNG output.
3. SVG is valid, has a white background, and exports successfully.
4. 2048 and optional 4096 PNG output has exact dimensions and no resampling damage.
5. Quiet-zone width is measured as at least the configured module count on every side.
6. Codes decode after realistic print/downscale, modest rotation, lighting, and camera-distance tests.
7. A real iPhone and Android device open the correct branch on staging and production-like printed material.

Use an independent decoder (not only the encoding library) in automated tests. Keep a small golden test set across short and maximum-length valid slugs.

## Physical printing guidance

- Prefer 70–100 mm square for an entrance/gate sign scanned from inside a vehicle.
- Treat 50 mm square as a practical minimum only for close handheld scanning; verify the actual URL density, printer, material, placement, glare, and expected distance.
- Preserve the complete white quiet zone; do not crop it or place graphics/text over it.
- Use matte, weather-resistant, high-contrast stock and avoid reflective glare.
- Leave surrounding visual space and print the short branch/service label outside the quiet zone.
- Test the final production proof on representative iOS and Android cameras before bulk printing.

Physical distance matters more than pixel count. Final sign size should keep each QR module comfortably printable (target roughly 0.5 mm or larger) and be increased for longer scan distances.

## Branch-aware web app manifest

Serve a dynamic, cacheable manifest at:

```text
/c/{branchSlug}/manifest.webmanifest
```

Proposed fields:

```json
{
  "id": "/c/{branchSlug}",
  "name": "حياك — {branchName}",
  "short_name": "حياك",
  "lang": "ar",
  "dir": "rtl",
  "start_url": "/c/{branchSlug}?source=pwa",
  "scope": "/c/{branchSlug}",
  "display": "standalone",
  "theme_color": "<Hayyak theme color>",
  "background_color": "#ffffff",
  "icons": [
    { "src": "/icons/hayyak-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/icons/hayyak-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "/icons/hayyak-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

The manifest's stable `id` and `start_url` preserve the branch entry point. The page references only its resolved branch manifest. The query marker is non-authoritative and used only for UX/measurement if retained; it must not affect branch identity.

Use a shared application shell and a single carefully scoped service worker where possible. Do not generate separate app bundles per branch. The exact service-worker scope needs a Phase 1 browser spike because a manifest scope does not itself control service-worker scope.

## Service worker and offline behavior

- Cache only versioned static assets, icons, and a minimal safe shell.
- Do not cache call status, queue responses, location submissions, LiveKit tokens, authenticated admin pages, or personalized API responses.
- A voice call requires network access. If offline, state that clearly in Arabic and offer retry; never simulate enqueue success.
- Prefer network-first navigation for branch pages so renamed/suspended branches and current configuration are respected.
- Service-worker updates must not interrupt an active call. Activate safely after the call or next navigation.

## Installation UX

The main page always prioritizes:

1. optional vehicle description;
2. **اتصل بالكوفي**.

A small, dismissible secondary invitation may say:

**أضف حياك إلى جوالك**  
**للوصول أسرع في المرة القادمة**

Actions: **إضافة** and **لاحقًا**. It must not overlay the main form on first load, delay permissions, or reflow the call button unexpectedly.

### Android/Chromium

- Listen for `beforeinstallprompt` where supported and retain the event only for the current page lifecycle.
- Show the custom CTA only when the event is available and dismissal rules allow it.
- Invoke the native prompt only after the user explicitly presses **إضافة**.
- Handle accepted, dismissed, and unavailable results; the call flow does not depend on any result.

### iPhone/iOS

Do not expect `beforeinstallprompt`. On supported iPhone browser contexts, show a short, dismissible Arabic guide only after the customer asks to add:

**أضف حياك إلى الشاشة الرئيسية**

1. افتح قائمة المشاركة.
2. اختر **إضافة إلى الشاشة الرئيسية**.
3. اضغط **إضافة**.

Use a small visual cue for the actual share/menu location where reliable, and account for Safari UI changes. Do not show Android instructions on iPhone or claim installation is available inside every in-app browser.

## Installed and dismissal detection

- Detect standalone display with `matchMedia('(display-mode: standalone)')`; also account for the relevant iOS standalone signal where supported.
- Stop all install suggestions while running standalone.
- Use the installation success event where available, but do not assume it is universal.
- Remember **لاحقًا** locally per branch with a gentle cooldown (for example 30 days), not a permanent server profile.
- Avoid repeated prompts across every visit. Provide a passive manual **إضافة إلى الشاشة الرئيسية** entry if useful.

## Browser limitations and unresolved behavior

- PWA install APIs and criteria vary by browser and change over time.
- iOS does not provide the Chromium install-prompt flow and has different manifest/icon/identity behavior.
- Multiple installed branch experiences may not be represented as distinct apps consistently on every OS, even with unique manifest ids.
- Some QR links open inside in-app browsers that cannot install or grant permissions well; offer **فتح في المتصفح** guidance only when detected and needed.
- A Phase 1 device spike must verify unique branch install identity, launch URL, icon/name, permission flow, and update behavior on current iOS Safari and Android Chrome before finalizing UX.

These limitations reinforce the core rule: QR → website → call always works without installation.

