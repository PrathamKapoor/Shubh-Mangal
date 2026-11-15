-- Extend the allowed kinds without rewriting existing rows or source evidence.
-- No entrance is created: reviewed coordinates must be supplied explicitly.
ALTER TABLE content DROP CONSTRAINT content_kind_check;
ALTER TABLE content ADD CONSTRAINT content_kind_check
  CHECK (kind IN ('setting','amenity','media','nearby','presentation','site_access'));
