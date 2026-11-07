-- Add a visual-only content kind. Existing rows and plot/geometry data are not changed.
ALTER TABLE content DROP CONSTRAINT content_kind_check;
ALTER TABLE content ADD CONSTRAINT content_kind_check
  CHECK (kind IN ('setting','amenity','media','nearby','presentation'));
