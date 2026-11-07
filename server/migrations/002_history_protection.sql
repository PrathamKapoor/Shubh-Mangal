CREATE TRIGGER protect_audit_truncate BEFORE TRUNCATE ON audit_logs FOR EACH STATEMENT EXECUTE FUNCTION reject_history_mutation();
CREATE TRIGGER protect_status_truncate BEFORE TRUNCATE ON inventory_status_history FOR EACH STATEMENT EXECUTE FUNCTION reject_history_mutation();
CREATE TRIGGER protect_verification_truncate BEFORE TRUNCATE ON plot_verifications FOR EACH STATEMENT EXECUTE FUNCTION reject_history_mutation();
CREATE TRIGGER protect_price_truncate BEFORE TRUNCATE ON price_records FOR EACH STATEMENT EXECUTE FUNCTION reject_history_mutation();
