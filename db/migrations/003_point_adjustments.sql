-- 003_point_adjustments.sql
-- Admin-granted bonus points, independent of mission submissions (e.g. "best
-- dressed", a spontaneous bonus). Kept as its own table rather than reusing
-- submissions — these aren't guest-authored content and don't need
-- moderation, just a note explaining why they were given.

CREATE TABLE point_adjustments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_id   text NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  points     integer NOT NULL,
  note       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX point_adjustments_guest_idx ON point_adjustments (guest_id);

-- Re-point guest_scores at scalar subqueries (rather than LEFT JOINs, which
-- would fan out and double-count) so it sums both submissions and
-- adjustments per guest.
CREATE OR REPLACE VIEW guest_scores AS
SELECT
  g.id   AS guest_id,
  g.name AS name,
  (
    COALESCE((
      SELECT SUM(s.points) FROM submissions s
      WHERE s.guest_id = g.id AND s.status <> 'rejected'
    ), 0)
    +
    COALESCE((
      SELECT SUM(pa.points) FROM point_adjustments pa
      WHERE pa.guest_id = g.id
    ), 0)
  )::int AS points,
  COALESCE((
    SELECT COUNT(*) FROM submissions s
    WHERE s.guest_id = g.id AND s.status = 'pending'
  ), 0)::int AS pending_count,
  COALESCE((
    SELECT COUNT(*) FROM submissions s
    WHERE s.guest_id = g.id AND s.status = 'approved'
  ), 0)::int AS approved_count
FROM guests g;
