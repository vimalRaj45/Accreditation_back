-- Hospital Accreditation & Compliance Management System Schema (Neon PostgreSQL)

-- 1. Hospitals Table
CREATE TABLE IF NOT EXISTS hospitals (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) UNIQUE NOT NULL,
    license_number VARCHAR(100),
    accreditation_target VARCHAR(100) DEFAULT 'NABH / JCI',
    address TEXT,
    contact_email VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Departments Table
CREATE TABLE IF NOT EXISTS departments (
    id SERIAL PRIMARY KEY,
    hospital_id INTEGER REFERENCES hospitals(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) NOT NULL,
    head_name VARCHAR(255),
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_hospital_dept_code UNIQUE (hospital_id, code)
);

-- 3. Users Table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    hospital_id INTEGER REFERENCES hospitals(id) ON DELETE CASCADE,
    department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN ('Super Admin', 'Hospital Admin', 'Department Head', 'Auditor', 'Staff')),
    phone VARCHAR(50),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. Accreditation Requirements Table
CREATE TABLE IF NOT EXISTS requirements (
    id SERIAL PRIMARY KEY,
    hospital_id INTEGER REFERENCES hospitals(id) ON DELETE CASCADE,
    department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
    standard VARCHAR(100) NOT NULL, -- e.g., NABH 5th Edition, JCI 7th, ISO 9001
    chapter VARCHAR(150),           -- e.g., Patient Safety & Quality (PSQ)
    code VARCHAR(50) NOT NULL,      -- e.g., PSQ.1, COP.3, PRE.2
    title VARCHAR(300) NOT NULL,
    description TEXT,
    status VARCHAR(50) DEFAULT 'Pending' CHECK (status IN ('Compliant', 'Partially Compliant', 'Non-Compliant', 'Pending', 'Under Review')),
    priority VARCHAR(50) DEFAULT 'Medium' CHECK (priority IN ('Low', 'Medium', 'High', 'Critical')),
    due_date DATE,
    assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
    compliance_score NUMERIC(5,2) DEFAULT 0.00,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. Key Performance Indicators (KPIs) Table
CREATE TABLE IF NOT EXISTS kpis (
    id SERIAL PRIMARY KEY,
    hospital_id INTEGER REFERENCES hospitals(id) ON DELETE CASCADE,
    department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) NOT NULL,
    category VARCHAR(100) DEFAULT 'Clinical Quality',
    target_value NUMERIC(10,2) NOT NULL,
    actual_value NUMERIC(10,2) DEFAULT 0.00,
    unit VARCHAR(50) DEFAULT '%',
    frequency VARCHAR(50) DEFAULT 'Monthly', -- Monthly, Quarterly, Weekly
    status VARCHAR(20) DEFAULT 'Red' CHECK (status IN ('Green', 'Yellow', 'Red')),
    calculation_formula TEXT,
    benchmark_source VARCHAR(255),
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);

-- 6. Audits Table
CREATE TABLE IF NOT EXISTS audits (
    id SERIAL PRIMARY KEY,
    hospital_id INTEGER REFERENCES hospitals(id) ON DELETE CASCADE,
    department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    audit_type VARCHAR(100) DEFAULT 'Internal Mock Audit',
    lead_auditor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    scheduled_date DATE NOT NULL,
    completed_date DATE,
    status VARCHAR(50) DEFAULT 'Scheduled' CHECK (status IN ('Scheduled', 'In Progress', 'Completed', 'Cancelled')),
    summary TEXT,
    score NUMERIC(5,2) DEFAULT 0.00,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 7. Audit Findings Table
CREATE TABLE IF NOT EXISTS audit_findings (
    id SERIAL PRIMARY KEY,
    audit_id INTEGER REFERENCES audits(id) ON DELETE CASCADE,
    requirement_id INTEGER REFERENCES requirements(id) ON DELETE SET NULL,
    title VARCHAR(300) NOT NULL,
    description TEXT NOT NULL,
    severity VARCHAR(30) NOT NULL CHECK (severity IN ('Minor', 'Major', 'Critical')),
    category VARCHAR(100) DEFAULT 'Documentation',
    suggested_action TEXT,
    status VARCHAR(50) DEFAULT 'Open' CHECK (status IN ('Open', 'Linked to CAPA', 'Resolved')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 8. Corrective Actions (CAPA) Table
CREATE TABLE IF NOT EXISTS corrective_actions (
    id SERIAL PRIMARY KEY,
    hospital_id INTEGER REFERENCES hospitals(id) ON DELETE CASCADE,
    department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
    finding_id INTEGER REFERENCES audit_findings(id) ON DELETE SET NULL,
    requirement_id INTEGER REFERENCES requirements(id) ON DELETE SET NULL,
    title VARCHAR(300) NOT NULL,
    description TEXT,
    root_cause TEXT,
    action_plan TEXT NOT NULL,
    assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
    due_date DATE NOT NULL,
    status VARCHAR(50) DEFAULT 'Open' CHECK (status IN ('Open', 'In Progress', 'Completed', 'Verified')),
    completion_date DATE,
    verified_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    verification_notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 9. Documents Table (Direct BYTEA Blob Storage in Postgres)
CREATE TABLE IF NOT EXISTS documents (
    id SERIAL PRIMARY KEY,
    hospital_id INTEGER REFERENCES hospitals(id) ON DELETE CASCADE,
    department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
    filename VARCHAR(255) NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    file_size INTEGER NOT NULL,
    file_data BYTEA NOT NULL,
    uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    linked_requirement_id INTEGER REFERENCES requirements(id) ON DELETE SET NULL,
    linked_audit_id INTEGER REFERENCES audits(id) ON DELETE SET NULL,
    linked_corrective_action_id INTEGER REFERENCES corrective_actions(id) ON DELETE SET NULL,
    doc_type VARCHAR(100) DEFAULT 'Evidence', -- Policy, SOP, Audit Evidence, License, Committee Minutes
    version VARCHAR(50) DEFAULT '1.0',
    expiry_date DATE,
    tags TEXT,
    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 10. Automated In-App Notifications Table
CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    hospital_id INTEGER REFERENCES hospitals(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(50) DEFAULT 'Alert', -- Alert, Warning, Info, Success
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    is_read BOOLEAN DEFAULT FALSE,
    link_url VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 11. Scoring Weights Configuration Table
CREATE TABLE IF NOT EXISTS scoring_weights (
    hospital_id INTEGER PRIMARY KEY REFERENCES hospitals(id) ON DELETE CASCADE,
    compliance_weight NUMERIC(4,2) DEFAULT 0.40,
    kpi_weight NUMERIC(4,2) DEFAULT 0.25,
    audit_weight NUMERIC(4,2) DEFAULT 0.20,
    evidence_weight NUMERIC(4,2) DEFAULT 0.15,
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_requirements_hospital ON requirements(hospital_id);
CREATE INDEX IF NOT EXISTS idx_requirements_status ON requirements(status);
CREATE INDEX IF NOT EXISTS idx_kpis_hospital ON kpis(hospital_id);
CREATE INDEX IF NOT EXISTS idx_audits_hospital ON audits(hospital_id);
CREATE INDEX IF NOT EXISTS idx_findings_audit ON audit_findings(audit_id);
CREATE INDEX IF NOT EXISTS idx_capa_hospital ON corrective_actions(hospital_id);
CREATE INDEX IF NOT EXISTS idx_documents_hospital ON documents(hospital_id);
CREATE INDEX IF NOT EXISTS idx_documents_req ON documents(linked_requirement_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);
