# AI Coding Rules & Architectural Standards

## Core Principles
1. **Direct Database Persistence**: All core couple features (Chat, Love Letters, Date Plans, Scrapbook Memories, Milestones, Prompts) sync in real-time with Firestore & Supabase.
2. **Strict Multi-Tenant Isolation**: Every database query and state filter enforces `couple_id` scoping to protect user privacy.
3. **Responsive Auto-Fit**: Mobile views must never overflow horizontally. Action controls scale to icon-only buttons on small viewports (`sm:` break).
4. **Documentation Sync**: Any architectural or functional change must be synchronized with `Home.md` and `docs/`.
