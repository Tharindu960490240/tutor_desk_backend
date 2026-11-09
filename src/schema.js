// TutorDesk database schema (runs automatically on the first request; safe to run many times).
// Generated from the SQL below – edit here.
export default String.raw`
-- TutorDesk database schema. Safe to run many times (everything is "IF NOT EXISTS").
-- Tables are created automatically on the API's first request.

CREATE TABLE IF NOT EXISTS users (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email             text NOT NULL,
  password_hash     text NOT NULL,
  name              text NOT NULL DEFAULT '',
  settings          jsonb NOT NULL DEFAULT '{}'::jsonb,
  token_version     integer NOT NULL DEFAULT 0,      -- bump to sign the user out everywhere
  terms_accepted_at timestamptz,
  last_seen_at      timestamptz,
  disabled          boolean NOT NULL DEFAULT false,  -- suspended by an admin
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (lower(email));

CREATE TABLE IF NOT EXISTS classes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          text NOT NULL,
  subject       text NOT NULL DEFAULT '',
  level         text NOT NULL DEFAULT '',
  location      text NOT NULL DEFAULT '',
  fee           numeric(12,2) NOT NULL DEFAULT 0,   -- monthly fee
  admission_fee numeric(12,2) NOT NULL DEFAULT 0,   -- one-time fee per student (0 = none)
  color         text NOT NULL DEFAULT '#0288d1',
  ends_on       date,                               -- class stopped permanently after this date
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS classes_user_idx ON classes (user_id);

-- Weekly meetings. A class can meet on many days, and more than once a day.
-- valid_from / valid_until keep history when the weekly schedule is changed permanently from a date.
CREATE TABLE IF NOT EXISTS class_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id     uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  weekday      smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),  -- 0 = Sunday
  start_time   char(5)  NOT NULL CHECK (start_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  duration_min integer  NOT NULL DEFAULT 60 CHECK (duration_min >= 0),
  valid_from   date,
  valid_until  date
);
CREATE INDEX IF NOT EXISTS class_sessions_class_idx ON class_sessions (class_id);

-- One-off changes to the timetable:
--   cancel : the meeting on \`date\` at \`time\` doesn't happen
--   move   : the meeting on \`date\` at \`time\` happens on \`new_date\` at \`new_time\` instead (same day = time change)
--   break  : no classes from \`date\` to \`new_date\` (holidays, exams...)
CREATE TABLE IF NOT EXISTS class_changes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  class_id     uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('cancel','move','break')),
  date         date NOT NULL,
  time         char(5),
  new_date     date,
  new_time     char(5),
  new_duration integer,
  note         text NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS class_changes_class_idx ON class_changes (class_id, date);

CREATE TABLE IF NOT EXISTS students (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         text NOT NULL,
  parent       text NOT NULL DEFAULT '',
  parent_phone text NOT NULL DEFAULT '',
  phone        text NOT NULL DEFAULT '',
  fee          numeric(12,2) NOT NULL DEFAULT 0,
  joined       date NOT NULL DEFAULT CURRENT_DATE,
  notes        text NOT NULL DEFAULT '',
  active       boolean NOT NULL DEFAULT true,
  ended_ym     char(7),
  lang         text NOT NULL DEFAULT 'en',
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS students_user_idx ON students (user_id);

CREATE TABLE IF NOT EXISTS student_classes (
  student_id       uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  class_id         uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  admission_waived boolean NOT NULL DEFAULT false,  -- tutor chose not to charge this student the admission fee
  PRIMARY KEY (student_id, class_id)
);

CREATE TABLE IF NOT EXISTS payments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  student_id uuid REFERENCES students(id) ON DELETE SET NULL,
  kind       text NOT NULL DEFAULT 'monthly' CHECK (kind IN ('monthly','admission')),
  class_id   uuid REFERENCES classes(id) ON DELETE SET NULL,  -- for admission payments
  ym         char(7) NOT NULL,           -- month the fee is for (admission: month it was paid)
  amount     numeric(12,2) NOT NULL CHECK (amount > 0),
  paid_on    date NOT NULL DEFAULT CURRENT_DATE,
  method     text NOT NULL DEFAULT 'cash',
  note       text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payments_user_ym_idx ON payments (user_id, ym);

-- One row per student per class meeting (class + date + start time)
CREATE TABLE IF NOT EXISTS attendance (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  class_id   uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  date       date NOT NULL,
  start_time char(5) NOT NULL,
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  status     char(1) NOT NULL CHECK (status IN ('P','L','A')),
  PRIMARY KEY (class_id, date, start_time, student_id)
);
CREATE INDEX IF NOT EXISTS attendance_user_date_idx ON attendance (user_id, date);

CREATE TABLE IF NOT EXISTS reminder_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  type       text NOT NULL,              -- fee | class | change | admission
  key        text NOT NULL DEFAULT '',
  sent_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reminder_log_user_idx ON reminder_log (user_id, sent_at DESC);

CREATE TABLE IF NOT EXISTS password_resets (
  token_hash text PRIMARY KEY,           -- sha256 of the emailed token (the token itself is never stored)
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS password_resets_user_idx ON password_resets (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS feedback (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  email      text NOT NULL DEFAULT '',
  message    text NOT NULL,
  page       text NOT NULL DEFAULT '',
  user_agent text NOT NULL DEFAULT '',
  emailed    boolean NOT NULL DEFAULT false,
  resolved   boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS feedback_created_idx ON feedback (created_at DESC);

-- App-wide settings the admin can change without redeploying (e.g. invite code)
CREATE TABLE IF NOT EXISTS app_settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
`;
