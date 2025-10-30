-- Performance optimization indexes for property queries
-- Run these SQL commands on your database to improve query performance

-- Index on property owner_id for faster property filtering by owner
CREATE INDEX IF NOT EXISTS idx_property_owner_id ON properties(owner_id);

-- Index on property status for faster status-based queries
CREATE INDEX IF NOT EXISTS idx_property_status ON properties(property_status);

-- Index on rent status and property_id for faster active rent lookups
CREATE INDEX IF NOT EXISTS idx_rent_status_property ON rents(rent_status, property_id);

-- Index on rent tenant_id for faster tenant-rent relationships
CREATE INDEX IF NOT EXISTS idx_rent_tenant_id ON rents(tenant_id);

-- Index on property_tenant status and property_id for faster active tenant lookups
CREATE INDEX IF NOT EXISTS idx_property_tenant_status_property ON property_tenants(status, property_id);

-- Index on property_tenant tenant_id for faster tenant relationships
CREATE INDEX IF NOT EXISTS idx_property_tenant_tenant_id ON property_tenants(tenant_id);

-- Index on property_history property_id for faster history lookups
CREATE INDEX IF NOT EXISTS idx_property_history_property_id ON property_histories(property_id);

-- Index on property_history tenant_id for faster tenant history
CREATE INDEX IF NOT EXISTS idx_property_history_tenant_id ON property_histories(tenant_id);

-- Index on property_history move_out_date for faster active tenancy checks
CREATE INDEX IF NOT EXISTS idx_property_history_move_out_date ON property_histories(move_out_date);

-- Composite index for property_history active tenancy queries
CREATE INDEX IF NOT EXISTS idx_property_history_active ON property_histories(property_id, tenant_id, move_out_date);

-- Index on service_requests property_id for faster service request lookups
CREATE INDEX IF NOT EXISTS idx_service_requests_property_id ON service_requests(property_id);

-- Index on service_requests status for faster status filtering
CREATE INDEX IF NOT EXISTS idx_service_requests_status ON service_requests(status);

-- Index on users phone_number for faster notification lookups
CREATE INDEX IF NOT EXISTS idx_users_phone_number ON users(phone_number);

-- Composite index for rent queries (property + status)
CREATE INDEX IF NOT EXISTS idx_rent_property_status ON rents(property_id, rent_status);

-- Composite index for property tenant queries (property + status)
CREATE INDEX IF NOT EXISTS idx_property_tenant_property_status ON property_tenants(property_id, status);