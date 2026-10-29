UPDATE domain_binding
SET route_status = CASE WHEN route_status = 'not_configured' THEN 'not_configured' ELSE 'pending' END,
    https_probe_status = 'not_run',
    https_probe_checked_at = NULL,
    https_probe_hostname = NULL,
    https_probe_peer_ip = NULL,
    https_probe_peer_ips_json = NULL,
    https_probe_http_status = NULL,
    https_probe_generation = NULL,
    https_probe_inventory_revision = NULL,
    https_probe_environment = NULL
WHERE route_status = 'active'
  AND (
    https_probe_peer_ips_json IS NULL
    OR json_type(https_probe_peer_ips_json) <> 'array'
    OR json_array_length(https_probe_peer_ips_json) < 1
    OR https_probe_http_status IS NULL
    OR https_probe_http_status NOT BETWEEN 200 AND 299
  );
