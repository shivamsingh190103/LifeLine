-- BloodBank Database Schema
-- Create database if not exists
CREATE DATABASE IF NOT EXISTS bloodbank_db;
USE bloodbank_db;

-- Users table for registration and authentication
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    phone VARCHAR(15),
    blood_group ENUM('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-') NOT NULL,
    location VARCHAR(200),
    city VARCHAR(100),
    state VARCHAR(100),
    latitude DECIMAL(10,7),
    longitude DECIMAL(10,7),
    is_donor BOOLEAN DEFAULT FALSE,
    is_recipient BOOLEAN DEFAULT FALSE,
    last_donation_date DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Blood requests table
CREATE TABLE IF NOT EXISTS blood_requests (
    id INT AUTO_INCREMENT PRIMARY KEY,
    requester_id INT,
    patient_name VARCHAR(100) NOT NULL,
    blood_group ENUM('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-') NOT NULL,
    units_required INT NOT NULL,
    hospital_name VARCHAR(200),
    hospital_address TEXT,
    urgency_level ENUM('Low', 'Medium', 'High', 'Emergency') DEFAULT 'Medium',
    contact_person VARCHAR(100),
    contact_phone VARCHAR(15),
    reason TEXT,
    status ENUM('Pending', 'In Progress', 'Completed', 'Cancelled') DEFAULT 'Pending',
    required_date DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (requester_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Blood donations table
CREATE TABLE IF NOT EXISTS blood_donations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    donor_id INT,
    request_id INT,
    donation_date DATE NOT NULL,
    blood_group ENUM('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-') NOT NULL,
    units_donated INT DEFAULT 1,
    donation_center VARCHAR(200),
    status ENUM('Scheduled', 'Completed', 'Cancelled') DEFAULT 'Scheduled',
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (donor_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (request_id) REFERENCES blood_requests(id) ON DELETE SET NULL
);

-- Contact messages table
CREATE TABLE IF NOT EXISTS contact_messages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) NOT NULL,
    phone VARCHAR(15),
    message TEXT NOT NULL,
    status ENUM('Unread', 'Read', 'Replied') DEFAULT 'Unread',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Blood inventory table
CREATE TABLE IF NOT EXISTS blood_inventory (
    id INT AUTO_INCREMENT PRIMARY KEY,
    blood_group ENUM('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-') NOT NULL,
    available_units INT DEFAULT 0,
    reserved_units INT DEFAULT 0,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_blood_group (blood_group)
);

-- Backward-compatible schema upgrades for existing databases
ALTER TABLE users ADD COLUMN IF NOT EXISTS latitude DECIMAL(10,7);
ALTER TABLE users ADD COLUMN IF NOT EXISTS longitude DECIMAL(10,7);

-- Insert initial blood inventory
INSERT IGNORE INTO blood_inventory (blood_group, available_units, reserved_units) VALUES
('A+', 0, 0),
('A-', 0, 0),
('B+', 0, 0),
('B-', 0, 0),
('AB+', 0, 0),
('AB-', 0, 0),
('O+', 0, 0),
('O-', 0, 0);

-- Create indexes for better performance
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_blood_group ON users(blood_group);
CREATE INDEX idx_users_location ON users(location);
CREATE INDEX idx_users_geo ON users(latitude, longitude);
CREATE INDEX idx_users_donor_geo ON users(is_donor, blood_group, latitude, longitude);
CREATE INDEX idx_blood_requests_status ON blood_requests(status);
CREATE INDEX idx_blood_requests_blood_group ON blood_requests(blood_group);
CREATE INDEX idx_blood_requests_requester_id ON blood_requests(requester_id);
CREATE INDEX idx_blood_requests_created_at ON blood_requests(created_at);
CREATE INDEX idx_blood_donations_donor_id ON blood_donations(donor_id);
CREATE INDEX idx_blood_donations_request_id ON blood_donations(request_id);
CREATE INDEX idx_blood_donations_status ON blood_donations(status);
CREATE INDEX idx_contact_messages_status ON contact_messages(status);
CREATE INDEX idx_contact_messages_created_at ON contact_messages(created_at);
