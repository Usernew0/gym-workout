# Architecture Documentation

## System Architecture

```
[ Browser Client ] <---> [ Express Server / Vite Middleware ]
        |
        +---> [ Firebase Firestore (Real-Time Collections) ]
        |
        +---> [ Supabase / Cloud SQL (PostgreSQL Sync) ]
```

## Notification Architecture
Notifications are **dynamically aggregated in real-time** by observing active database collections (Messages, Letters, Date Plans, Milestones, Prompts, Invites) scoped to `couple_id`. Read and cleared states are persisted via user-specific `localStorage` keys (`love_read_notification_ids`, `love_cleared_notification_ids`).
