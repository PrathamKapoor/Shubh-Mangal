-- Forward-only and data-preserving: all previously valid statuses remain valid.
-- A no-show, like a completed visit, must refer to an agreed scheduled time.
ALTER TABLE visit_requests DROP CONSTRAINT visit_requests_status_check;
ALTER TABLE visit_requests ADD CONSTRAINT visit_requests_status_check
  CHECK (status IN ('requested','contacted','confirmed','rescheduled','completed','no_show','cancelled'));
ALTER TABLE visit_requests ADD CONSTRAINT visit_requests_no_show_scheduled_check
  CHECK (status <> 'no_show' OR scheduled_at IS NOT NULL);
