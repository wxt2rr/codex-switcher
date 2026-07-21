## 1. Settings and contracts

- [x] 1.1 Add disabled-by-default persisted badge settings and normalization tests
- [x] 1.2 Add runtime status, permission, and mutation contracts across main, preload, and renderer bridges

## 2. Badge manager and platform adapters

- [x] 2.1 Implement deterministic environment badge identity and serialized event-driven manager
- [x] 2.2 Implement same-process macOS Accessibility permission and Dock N-API adapter contracts
- [x] 2.3 Implement Windows taskbar helper adapter contracts and graceful unsupported fallback
- [x] 2.4 Synchronize badges on startup, activation, successful managed launches, enable, and disable

## 3. Settings experience

- [x] 3.1 Add a platform-aware settings switch using the existing green toggle style
- [x] 3.2 Add the macOS first-enable explanation and continue/cancel permission flow
- [x] 3.3 Add localized complete, partial, denied, and unsupported notices without automatic restart

## 4. Packaging and verification

- [x] 4.1 Package platform helper resources and verify missing helpers degrade safely
- [x] 4.2 Add unit/contract tests for settings, identity, manager lifecycle, bridge exposure, and settings UI
- [x] 4.3 Run desktop build and focused/full tests, then document native platform validation risks
