-- Run as the database owner AFTER migrations, using psql. Set passwords via \password,
-- your secrets manager, or managed provider, never commit credentials here.
-- Adapt role names if your provider provisions accounts separately.
CREATE ROLE shubh_runtime LOGIN;
GRANT CONNECT ON DATABASE shubh_mangal TO shubh_runtime;
GRANT USAGE ON SCHEMA public TO shubh_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO shubh_runtime;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON schema_migrations FROM shubh_runtime;
REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs, inventory_status_history, plot_verifications, price_records FROM shubh_runtime;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
-- The runtime role must not own tables, be superuser, have BYPASSRLS, or be allowed to ALTER triggers.
-- Future migrations must repeat grants for new tables. Keep migration credentials separate.
