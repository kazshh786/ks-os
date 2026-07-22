# Custom booking domains

The application implements the safe configuration foundation but does not claim to provision DNS or certificates by itself.

## Current flow

1. An owner submits a valid hostname in Booking Page settings.
2. The API checks that the hostname is not attached to another booking page.
3. The page enters `PENDING` and receives a one-time TXT proof instruction at `_ksos-booking.<hostname>`.
4. Only a future trusted provider-verification process may set the state to `VERIFIED`, make the host canonical, and route public traffic by hostname.
5. Removing the hostname clears its verification and canonical state.

The verification value returned to staff is not stored in plaintext; a hash is stored for a future verifier. Public host resolution requires both `custom_domain_status = VERIFIED` and an enabled/published page.

## Infrastructure still required

- choose the authoritative deployment/DNS provider;
- implement provider API calls or a background verifier for TXT/ownership proof;
- bind the hostname to the deployment and wait for certificate issuance;
- monitor renewal and routing health;
- activate canonical metadata and redirects only after HTTPS succeeds;
- define retry, timeout, revocation and support procedures;
- audit every verification-state transition.

Never ask a customer to replace broad account nameservers or provide registrar credentials. Prefer the minimum CNAME/TXT records required by the selected provider. Do not mark a domain verified based only on a browser-supplied success response.
