# Changelog

## 0.1.0

- Changed `.do()` to accept one run object: use `{ data, output, ...options }` instead of a separate data argument.
- Added shared `initAutomify()` entrypoint.
- Added browser automation with Playwright.
- Added CLI automation with command approval and command policies.
- Added custom/native computer adapter surface.
- Added observability hooks and debug logging.
- Added unit, browser E2E, and optional live OpenAI E2E tests.
