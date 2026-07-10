/**
 * Domain Management Integration Service
 * Wraps Vercel API and Cloudflare API to provision, configure, and teardown
 * test and custom domains with transactional integrity and safety overrides.
 */

/**
 * Adds a domain to the Vercel project.
 * Returns the Vercel API response containing verification information if the domain is not yet verified.
 */
export async function addDomainToVercel(domainName: string) {
  const token = process.env.VERCEL_AUTH_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;
  const teamId = process.env.VERCEL_TEAM_ID;

  if (!token || !projectId) {
    console.warn('WARNING: Vercel integration is not fully configured (missing VERCEL_AUTH_TOKEN or VERCEL_PROJECT_ID).');
    return { verified: true, verification: [], warning: 'Vercel configuration missing' };
  }

  const query = new URLSearchParams();
  if (teamId) query.append('teamId', teamId);

  const url = `https://api.vercel.com/v9/projects/${projectId}/domains?${query.toString()}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: domainName }),
  });

  if (res.status === 409) {
    // Domain already exists in project, fetch its info to check verification status
    console.log(`Domain ${domainName} already exists on Vercel. Fetching domain details...`);
    const getUrl = `https://api.vercel.com/v9/projects/${projectId}/domains/${domainName}?${query.toString()}`;
    const getRes = await fetch(getUrl, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (getRes.ok) {
      const data = await getRes.json();
      return {
        verified: data.verified,
        verification: data.verification || [],
      };
    }
  }

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Vercel API error when adding domain: ${res.status} - ${errorText}`);
  }

  const data = await res.json();
  return {
    verified: data.verified,
    verification: data.verification || [],
  };
}

/**
 * Removes a domain association from the Vercel project.
 */
export async function removeDomainFromVercel(domainName: string) {
  const token = process.env.VERCEL_AUTH_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;
  const teamId = process.env.VERCEL_TEAM_ID;

  if (!token || !projectId) {
    console.warn('WARNING: Vercel integration is not fully configured. Skipping domain removal.');
    return;
  }

  const query = new URLSearchParams();
  if (teamId) query.append('teamId', teamId);

  const url = `https://api.vercel.com/v9/projects/${projectId}/domains/${domainName}?${query.toString()}`;

  const res = await fetch(url, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  if (!res.ok && res.status !== 404) {
    const errorText = await res.text();
    throw new Error(`Vercel API error when removing domain: ${res.status} - ${errorText}`);
  }
}

/**
 * Adds a CNAME record on Cloudflare for the test subdomain pointing to Vercel DNS.
 * Hardcodes "proxied": false to prevent SSL/redirect loops.
 */
export async function addCloudflareCname(subdomain: string) {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;

  if (!token || !zoneId) {
    console.warn('WARNING: Cloudflare integration is not fully configured (missing CLOUDFLARE_API_TOKEN or CLOUDFLARE_ZONE_ID).');
    return;
  }

  const recordName = `${subdomain.toLowerCase()}.kasimshah.com`;
  const url = `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`;

  // Check if the CNAME record already exists to prevent duplicate failures
  const checkUrl = `${url}?name=${encodeURIComponent(recordName)}&type=CNAME`;
  const checkRes = await fetch(checkUrl, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (checkRes.ok) {
    const checkData = await checkRes.json();
    if (checkData.success && checkData.result && checkData.result.length > 0) {
      console.log(`Cloudflare CNAME record for ${recordName} already exists. Skipping creation.`);
      return;
    }
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: 'CNAME',
      name: recordName,
      content: 'cname.vercel-dns.com',
      ttl: 1, // Automatic TTL
      proxied: false, // Enforce proxied false safeguard!
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Cloudflare API error when creating CNAME record: ${res.status} - ${errorText}`);
  }

  const data = await res.json();
  if (!data.success) {
    throw new Error(`Cloudflare API failed to create CNAME record: ${JSON.stringify(data.errors)}`);
  }
}

/**
 * Removes the CNAME record on Cloudflare for the given test subdomain.
 */
export async function removeCloudflareCname(subdomain: string) {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;

  if (!token || !zoneId) {
    console.warn('WARNING: Cloudflare integration is not fully configured. Skipping CNAME removal.');
    return;
  }

  const recordName = `${subdomain.toLowerCase()}.kasimshah.com`;
  const url = `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records?name=${encodeURIComponent(recordName)}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Cloudflare API error when listing DNS records: ${res.status} - ${errorText}`);
  }

  const data = await res.json();
  if (!data.success) {
    throw new Error(`Cloudflare API failed to list DNS records: ${JSON.stringify(data.errors)}`);
  }

  const records = data.result || [];
  for (const record of records) {
    const deleteUrl = `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records/${record.id}`;
    const deleteRes = await fetch(deleteUrl, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!deleteRes.ok) {
      const errorText = await deleteRes.text();
      throw new Error(`Cloudflare API error when deleting DNS record: ${deleteRes.status} - ${errorText}`);
    }

    const deleteData = await deleteRes.json();
    if (!deleteData.success) {
      throw new Error(`Cloudflare API failed to delete DNS record: ${JSON.stringify(deleteData.errors)}`);
    }
    console.log(`Successfully deleted Cloudflare CNAME record for ${recordName} (ID: ${record.id})`);
  }
}
