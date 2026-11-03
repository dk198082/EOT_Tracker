---
name: Attachment previews
description: Browser-safe and security-conscious attachment preview behavior.
---

Render attachment previews from an authenticated, same-origin endpoint that
streams the object with an inline content disposition. Do not frame presigned
storage URLs or blob URLs for PDF previews.

**Why:** Microsoft Edge can block signed or blob PDF URLs inside an iframe,
even when a client-side fetch first converts the file to a blob. A same-origin
stream avoids that browser restriction and keeps storage URLs private.

**How to apply:** Permit inline preview only for explicitly safe raster image
types and PDFs, send `nosniff` and private cache headers, verify the attachment
belongs to the requested ETO, and keep other file types download-only. Because
an iframe cannot attach the app's bearer token, first mint a short-lived signed
same-origin preview link through an authenticated API call.