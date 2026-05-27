// Phase 4: schedule-service. Stubbed in Phase 1 — implementation lands in Phase 4.
//
// Will own the scheduling UI's CRUD operations on `scheduled_posts` plus
// the cron poller that picks pending rows whose scheduledTime <= now() and
// hands them to posting-service.

export const scheduleService = {} as const;
