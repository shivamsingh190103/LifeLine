-- BloodBank PostgreSQL Schema (Supabase compatible)

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    email_verified BOOLEAN DEFAULT TRUE,
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
    blood_group VARCHAR(3) NOT NULL UNIQUE CHECK (blood_group IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
    available_units INT DEFAULT 0 CHECK (available_units >= 0),
    reserved_units INT DEFAULT 0 CHECK (reserved_units >= 0),
    last_updated TIMESTAMPTZ DEFAULT NOW()
);

-- Backward-compatible schema upgrades
ALTER TABLE users ADD COLUMN IF NOT EXISTS latitude NUMERIC(10, 7);
ALTER TABLE users ADD COLUMN IF NOT EXISTS longitude NUMERIC(10, 7);
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT TRUE;

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
INSERT INTO blood_inventory (blood_group, available_units, reserved_units) VALUES
('A+', 0, 0),
('A-', 0, 0),
('B+', 0, 0),
('B-', 0, 0),
('AB+', 0, 0),
('AB-', 0, 0),
('O+', 0, 0),
('O-', 0, 0)
ON CONFLICT (blood_group) DO NOTHING;

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
