-- Extend allowed kinds without changing or creating content rows.
ALTER TABLE content DROP CONSTRAINT content_kind_check;
ALTER TABLE content ADD CONSTRAINT content_kind_check
  CHECK (kind IN ('setting','amenity','media','nearby','presentation','site_access','structure'));
