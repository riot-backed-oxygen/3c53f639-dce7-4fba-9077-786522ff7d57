-- Apply once if actresses has no visible BTREE index starting with height_cm.
-- This index supports height ranges; existing indexes still support list sorting.
ALTER TABLE actresses
  ADD INDEX idx_height_cm (height_cm),
  ALGORITHM=INPLACE,
  LOCK=NONE;
