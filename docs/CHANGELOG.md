# Project Changelog

## [Latest] - 2026-07-30
- **Notifications Dialog**:
  - Enhanced category filter tabs (`All`, `Unread`, `Chat`, `Letters`, `Activities`) with responsive 5-column grid auto-fitting across mobile/desktop viewports without horizontal scrolling.
  - Added real-time category item badges and liquid Framer Motion pill transitions.
  - Streamlined dialog modal header and removed redundant footer block.
  - Explained real-time database aggregation & local storage persistence model.
- **Admin Panel Automated Test Suite (`src/utils/autoTester.ts`)**:
  - Integrated full automated diagnostic test suite runner into the Admin Panel (`Automated Test Report` section).
  - Runs automated assertions covering Storage & Local State, Database Connectivity (Firestore/Supabase), Schema Integrity, Browser & Runtime APIs, Navigation Registry, Mobile Horizontal Overflow & 10-Preset Viewport Breakpoints, Multi-Tenant `couple_id` Privacy Isolation, and Notification Modal 5-Column Grid Auto-Fit.
  - Features real-time status filtering, text search, report downloading (`.txt`), and one-click copy of warnings and failed test remedies.
- **Header & Mobile Navigation**:
  - Compact icon-only header controls on mobile viewports (`p-1.5` / `p-2`) for Subscription, Profile, Notifications, and Lock/Logout.
