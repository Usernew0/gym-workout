# Quality, Testing, Responsive, Security & Performance Guides

## Quality Checklist
- [x] TypeScript strict compilation passes (`tsc --noEmit`)
- [x] Linter runs without warnings or errors
- [x] Mobile responsiveness verified across 320px–1920px viewports
- [x] Zero horizontal page scroll or overflow

## Responsive Guide
- Mobile controls use compact icon padding (`p-1.5` / `p-2`).
- Dialogs use flex column layouts with auto-fitting grid tabs (`grid-cols-5`).

## Security & Multi-Tenant Isolation
- Firestore and Supabase queries enforce `couple_id` scoping.
- Local storage keys are namespaced per user session.
