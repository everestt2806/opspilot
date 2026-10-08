-- Legacy VPS rows remain NULL and are blocked by SshManager until verified by the user.
ALTER TABLE vps ADD COLUMN host_fingerprint TEXT;
