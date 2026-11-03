---
name: Attachment OCR isolation
description: Runtime constraints for safely extracting attachment text with OfficeParser and Tesseract under Node 24.
---

Keep OfficeParser and Tesseract external to the API bundle. Disable OfficeParser's in-process OCR, and run standalone image OCR in a bounded child process with language-data caching outside the workspace.

**Why:** Bundling rewrites Tesseract worker paths, while OfficeParser's in-process OCR worker can raise an uncaught worker-thread error that terminates the Node 24 API process. Child-process isolation turns that failure into a per-attachment error instead.

**How to apply:** Preserve externalization when changing the API build. Any new OCR path must have process isolation, timeout/output limits, and temporary/cache files outside the repository.