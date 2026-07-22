# Team permissions

Capabilities are defined in `@ks-os/auth`. Owners always receive every capability. Staff receive defaults from the Practitioner, Receptionist, or Manager access profile plus explicit per-user overrides.

Overrides are evaluated by the API, not trusted from client state. Staff overrides cannot grant owner-only capabilities such as team administration, finance, refunds, payment integrations, business settings, or financial reports. Setting an allowed capability to `false` removes it.

