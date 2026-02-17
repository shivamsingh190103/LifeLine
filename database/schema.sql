-- BloodBank PostgreSQL Schema (Supabase compatible)

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    email_verified BOOLEAN DEFAULT TRUE,
    role VARCHAR(20) DEFAULT 'user' CHECK (role IN ('user', 'hospital', 'blood_bank', 'doctor', 'admin')),
    is_verified BOOLEAN DEFAULT FALSE,
    license_number VARCHAR(100),
    facility_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    is_active BOOLEAN DEFAULT TRUE,
    alert_snooze_until TIMESTAMPTZ,
    phone VARCHAR(20),
    blood_group VARCHAR(3) NOT NULL CHECK (blood_group IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
    location VARCHAR(200),
    city VARCHAR(100),
    state VARCHAR(100),
    latitude NUMERIC(10, 7),
    longitude NUMERIC(10, 7),
    is_donor BOOLEAN DEFAULT FALSE,
    is_recipient BOOLEAN DEFAULT FALSE,
    last_donation_date DATE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Email verification tokens table
CREATE TABLE IF NOT EXISTS email_verification_tokens (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(128) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Password reset tokens table
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(128) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Blood requests table
CREATE TABLE IF NOT EXISTS blood_requests (
    id BIGSERIAL PRIMARY KEY,
    requester_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    patient_name VARCHAR(100) NOT NULL,
    blood_group VARCHAR(3) NOT NULL CHECK (blood_group IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
    units_required INT NOT NULL CHECK (units_required > 0),
    hospital_name VARCHAR(200),
    hospital_address TEXT,
    urgency_level VARCHAR(20) DEFAULT 'Medium' CHECK (urgency_level IN ('Low', 'Medium', 'High', 'Emergency')),
    contact_person VARCHAR(100),
    contact_phone VARCHAR(20),
    reason TEXT,
    status VARCHAR(20) DEFAULT 'Pending' CHECK (status IN ('Pending', 'In Progress', 'Completed', 'Cancelled')),
    verification_required BOOLEAN DEFAULT FALSE,
    verification_status VARCHAR(30) DEFAULT 'Not Required'
      CHECK (verification_status IN ('Not Required', 'Pending Verification', 'Verified', 'Rejected')),
    requisition_image_url TEXT,
    verified_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    verified_at TIMESTAMPTZ,
    verification_notes TEXT,
    call_room_url TEXT,
    call_room_created_at TIMESTAMPTZ,
    required_date DATE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Blood donations table
CREATE TABLE IF NOT EXISTS blood_donations (
    id BIGSERIAL PRIMARY KEY,
    donor_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    request_id BIGINT REFERENCES blood_requests(id) ON DELETE SET NULL,
    donation_date DATE NOT NULL,
    blood_group VARCHAR(3) NOT NULL CHECK (blood_group IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
    units_donated INT DEFAULT 1 CHECK (units_donated > 0),
    donation_center VARCHAR(200),
    status VARCHAR(20) DEFAULT 'Scheduled' CHECK (status IN ('Scheduled', 'Completed', 'Cancelled')),
    completion_verified BOOLEAN DEFAULT FALSE,
    completed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    completion_verified_at TIMESTAMPTZ,
    completion_method VARCHAR(30) DEFAULT 'self'
      CHECK (completion_method IN ('self', 'hospital_scan', 'blood_bank_scan', 'doctor_verify', 'admin_verify')),
    verification_qr_token VARCHAR(120) UNIQUE,
    verification_qr_expires_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Contact messages table
CREATE TABLE IF NOT EXISTS contact_messages (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) NOT NULL,
    phone VARCHAR(20),
    message TEXT NOT NULL,
    status VARCHAR(20) DEFAULT 'Unread' CHECK (status IN ('Unread', 'Read', 'Replied')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Application feedback table
CREATE TABLE IF NOT EXISTS app_feedback (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    category VARCHAR(50) DEFAULT 'General',
    feedback_text TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Blood inventory table
CREATE TABLE IF NOT EXISTS blood_inventory (
    id BIGSERIAL PRIMARY KEY,
    hospital_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
    blood_group VARCHAR(3) NOT NULL CHECK (blood_group IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
    available_units INT DEFAULT 0 CHECK (available_units >= 0),
    reserved_units INT DEFAULT 0 CHECK (reserved_units >= 0),
    last_updated TIMESTAMPTZ DEFAULT NOW()
);

-- Persistent in-app notifications (used for passive stock alerts / call links / workflow notices)
CREATE TABLE IF NOT EXISTS user_notifications (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(150) NOT NULL,
    message TEXT NOT NULL,
    type VARCHAR(30) DEFAULT 'info' CHECK (type IN ('info', 'success', 'warning', 'error')),
    metadata JSONB DEFAULT '{}'::jsonb,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    read_at TIMESTAMPTZ
);

-- Backward-compatible schema upgrades
ALTER TABLE users ADD COLUMN IF NOT EXISTS latitude NUMERIC(10, 7);
ALTER TABLE users ADD COLUMN IF NOT EXISTS longitude NUMERIC(10, 7);
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'user';
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS license_number VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS facility_id BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS alert_snooze_until TIMESTAMPTZ;

UPDATE users
SET role = COALESCE(NULLIF(TRIM(role), ''), 'user')
WHERE role IS NULL OR TRIM(role) = '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_role_check'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_role_check
      CHECK (role IN ('user', 'hospital', 'blood_bank', 'doctor', 'admin'));
  END IF;
END
$$;

ALTER TABLE blood_requests ADD COLUMN IF NOT EXISTS verification_required BOOLEAN DEFAULT FALSE;
ALTER TABLE blood_requests ADD COLUMN IF NOT EXISTS verification_status VARCHAR(30) DEFAULT 'Not Required';
ALTER TABLE blood_requests ADD COLUMN IF NOT EXISTS requisition_image_url TEXT;
ALTER TABLE blood_requests ADD COLUMN IF NOT EXISTS verified_by BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE blood_requests ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
ALTER TABLE blood_requests ADD COLUMN IF NOT EXISTS verification_notes TEXT;
ALTER TABLE blood_requests ADD COLUMN IF NOT EXISTS call_room_url TEXT;
ALTER TABLE blood_requests ADD COLUMN IF NOT EXISTS call_room_created_at TIMESTAMPTZ;

UPDATE blood_requests
SET verification_status = CASE
  WHEN urgency_level IN ('High', 'Emergency') THEN 'Pending Verification'
  ELSE 'Not Required'
END
WHERE verification_status IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'blood_requests_verification_status_check'
  ) THEN
    ALTER TABLE blood_requests
      ADD CONSTRAINT blood_requests_verification_status_check
      CHECK (verification_status IN ('Not Required', 'Pending Verification', 'Verified', 'Rejected'));
  END IF;
END
$$;

ALTER TABLE blood_donations ADD COLUMN IF NOT EXISTS completion_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE blood_donations ADD COLUMN IF NOT EXISTS completed_by BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE blood_donations ADD COLUMN IF NOT EXISTS completion_verified_at TIMESTAMPTZ;
ALTER TABLE blood_donations ADD COLUMN IF NOT EXISTS completion_method VARCHAR(30) DEFAULT 'self';
ALTER TABLE blood_donations ADD COLUMN IF NOT EXISTS verification_qr_token VARCHAR(120) UNIQUE;
ALTER TABLE blood_donations ADD COLUMN IF NOT EXISTS verification_qr_expires_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'blood_donations_completion_method_check'
  ) THEN
    ALTER TABLE blood_donations
      ADD CONSTRAINT blood_donations_completion_method_check
      CHECK (completion_method IN ('self', 'hospital_scan', 'blood_bank_scan', 'doctor_verify', 'admin_verify'));
  END IF;
END
$$;

ALTER TABLE blood_inventory ADD COLUMN IF NOT EXISTS hospital_id BIGINT REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE blood_inventory DROP CONSTRAINT IF EXISTS blood_inventory_blood_group_key;

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION set_updated_at_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

DROP TRIGGER IF EXISTS trg_blood_requests_updated_at ON blood_requests;
CREATE TRIGGER trg_blood_requests_updated_at
BEFORE UPDATE ON blood_requests
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

DROP TRIGGER IF EXISTS trg_blood_donations_updated_at ON blood_donations;
CREATE TRIGGER trg_blood_donations_updated_at
BEFORE UPDATE ON blood_donations
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

-- Keep last_updated in blood_inventory fresh
CREATE OR REPLACE FUNCTION set_inventory_last_updated()
RETURNS TRIGGER AS $$
BEGIN
    NEW.last_updated = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_blood_inventory_last_updated ON blood_inventory;
CREATE TRIGGER trg_blood_inventory_last_updated
BEFORE UPDATE ON blood_inventory
FOR EACH ROW
EXECUTE FUNCTION set_inventory_last_updated();

-- Seed initial inventory
INSERT INTO blood_inventory (hospital_id, blood_group, available_units, reserved_units)
SELECT NULL, seed.blood_group, 0, 0
FROM (
  VALUES
    ('A+'),
    ('A-'),
    ('B+'),
    ('B-'),
    ('AB+'),
    ('AB-'),
    ('O+'),
    ('O-')
) AS seed(blood_group)
WHERE NOT EXISTS (
  SELECT 1
  FROM blood_inventory bi
  WHERE bi.hospital_id IS NULL
    AND bi.blood_group = seed.blood_group
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_blood_group ON users(blood_group);
CREATE INDEX IF NOT EXISTS idx_users_location ON users(location);
CREATE INDEX IF NOT EXISTS idx_users_geo ON users(latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_users_donor_geo ON users(is_donor, blood_group, latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_users_email_verified ON users(email_verified);

CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_user_id ON email_verification_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_expires_at ON email_verification_tokens(expires_at);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires_at ON password_reset_tokens(expires_at);

CREATE INDEX IF NOT EXISTS idx_blood_requests_status ON blood_requests(status);
CREATE INDEX IF NOT EXISTS idx_blood_requests_blood_group ON blood_requests(blood_group);
CREATE INDEX IF NOT EXISTS idx_blood_requests_requester_id ON blood_requests(requester_id);
CREATE INDEX IF NOT EXISTS idx_blood_requests_created_at ON blood_requests(created_at);

CREATE INDEX IF NOT EXISTS idx_blood_donations_donor_id ON blood_donations(donor_id);
CREATE INDEX IF NOT EXISTS idx_blood_donations_request_id ON blood_donations(request_id);
CREATE INDEX IF NOT EXISTS idx_blood_donations_status ON blood_donations(status);
CREATE INDEX IF NOT EXISTS idx_blood_donations_completion_verified ON blood_donations(completion_verified);
CREATE INDEX IF NOT EXISTS idx_blood_donations_qr_token ON blood_donations(verification_qr_token);

CREATE UNIQUE INDEX IF NOT EXISTS idx_blood_inventory_global_unique
ON blood_inventory (blood_group)
WHERE hospital_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_blood_inventory_hospital_unique
ON blood_inventory (hospital_id, blood_group)
WHERE hospital_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_blood_inventory_hospital_id ON blood_inventory(hospital_id);
CREATE INDEX IF NOT EXISTS idx_blood_requests_verification_status ON blood_requests(verification_status);
CREATE INDEX IF NOT EXISTS idx_blood_requests_verification_required ON blood_requests(verification_required);
CREATE INDEX IF NOT EXISTS idx_users_role_verified ON users(role, is_verified);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active);
CREATE INDEX IF NOT EXISTS idx_users_alert_snooze_until ON users(alert_snooze_until);

CREATE INDEX IF NOT EXISTS idx_contact_messages_status ON contact_messages(status);
CREATE INDEX IF NOT EXISTS idx_contact_messages_created_at ON contact_messages(created_at);

CREATE INDEX IF NOT EXISTS idx_app_feedback_rating ON app_feedback(rating);
CREATE INDEX IF NOT EXISTS idx_app_feedback_created_at ON app_feedback(created_at);
CREATE INDEX IF NOT EXISTS idx_app_feedback_user_id ON app_feedback(user_id);

-- Backward-compatible feedback schema upgrade
ALTER TABLE app_feedback ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
UPDATE app_feedback SET updated_at = created_at WHERE updated_at IS NULL;

-- Ensure one feedback row per user before enforcing uniqueness
DELETE FROM app_feedback af
USING app_feedback newer
WHERE af.user_id IS NOT NULL
  AND newer.user_id = af.user_id
  AND (
    COALESCE(newer.updated_at, newer.created_at) > COALESCE(af.updated_at, af.created_at)
    OR (
      COALESCE(newer.updated_at, newer.created_at) = COALESCE(af.updated_at, af.created_at)
      AND newer.id > af.id
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_app_feedback_user_unique
ON app_feedback(user_id)
WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_user_notifications_user_id_created_at
ON user_notifications(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_notifications_unread
ON user_notifications(user_id, is_read)
WHERE is_read = FALSE;
