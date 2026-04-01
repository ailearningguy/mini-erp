# Product Module Changelog

## [2026.04.01]
### Fixed
- TOCTOU race condition in update() -- version check now inside transaction
- Delete event renamed from `product.deleted.v1` to `product.deactivated.v1`

### Added
- Module documentation (README, API, ARCHITECTURE, CHANGELOG)
