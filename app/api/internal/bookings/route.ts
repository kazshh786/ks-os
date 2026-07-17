import { NextResponse } from 'next/server';
import { serviceClient } from '@/lib/service-api';

// Utility helper to authenticate request (supports staff session token or magic link bookingReference verification)
async function authenticateRequest(req: Request, tenantId: string, appointmentId?: string, bookingReference?: string) {
  const client = serviceClient();

  // 1. Magic Link / Customer Booking Reference Verification
  if (bookingReference && appointmentId) {
    const { data: appt } = await client
      .from('appointments')
      .select('id, tenant_id, booking_reference')
      .eq('id', appointmentId)
      .eq('tenant_id', tenantId)
      .eq('booking_reference', bookingReference)
      .maybeSingle();

    if (appt) {
      return { client, isStaff: false };
    }
  }

  // 2. Staff Authentication via Session Token
  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');

  if (!token) {
    return { errorResponse: NextResponse.json({ error: 'Unauthorized: Missing session token.' }, { status: 401 }) };
  }

  const { data: { user }, error: verifyErr } = await client.auth.getUser(token);
  if (verifyErr || !user) {
    return { errorResponse: NextResponse.json({ error: 'Unauthorized: Invalid token.' }, { status: 401 }) };
  }

  const { data: dbUser } = await client
    .from('users')
    .select('tenant_id, role')
    .eq('id', user.id)
    .eq('tenant_id', tenantId)
    .single();

  if (!dbUser) {
    return { errorResponse: NextResponse.json({ error: 'Forbidden: Access denied to this salon.' }, { status: 403 }) };
  }

  return { client, isStaff: true, user: dbUser };
}

// POST: Atomic Internal Booking Creation
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      tenantId,
      serviceId,
      staffId,
      startTime,
      endTime,
      clientName,
      clientEmail,
      clientPhone,
      status,
      notes,
      resourceId,
      clientId,
      idempotencyKey
    } = body;

    if (!tenantId || !staffId || !startTime || !status) {
      return NextResponse.json({ error: 'Missing required fields: tenantId, staffId, startTime, status' }, { status: 400 });
    }

    const auth = await authenticateRequest(req, tenantId);
    if (auth.errorResponse) return auth.errorResponse;
    const { client } = auth;

    // Call RPC create_internal_booking
    const { data, error } = await client.rpc('create_internal_booking', {
      p_tenant_id: tenantId,
      p_service_id: serviceId || null,
      p_staff_id: staffId,
      p_start_time: startTime,
      p_end_time: endTime || null,
      p_client_name: clientName || null,
      p_client_email: clientEmail || null,
      p_client_phone: clientPhone || null,
      p_status: status,
      p_notes: notes || '',
      p_resource_id: resourceId || null,
      p_client_id: clientId || null,
      p_idempotency_key: idempotencyKey || null
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }

    return NextResponse.json({ success: true, booking: data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// PATCH: Atomic Internal Booking Update (Reschedule / Drag-and-drop / Resize / Customer Magic Link)
export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const {
      tenantId,
      appointmentId,
      staffId,
      startTime,
      endTime,
      status,
      notes,
      resourceId,
      mobileAddress,
      bookingReference
    } = body;

    if (!tenantId || !appointmentId || !staffId || !startTime || !endTime || !status) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const auth = await authenticateRequest(req, tenantId, appointmentId, bookingReference);
    if (auth.errorResponse) return auth.errorResponse;
    const { client } = auth;

    // Call RPC update_internal_booking
    const { data, error } = await client.rpc('update_internal_booking', {
      p_tenant_id: tenantId,
      p_appointment_id: appointmentId,
      p_staff_id: staffId,
      p_start_time: startTime,
      p_end_time: endTime,
      p_status: status,
      p_notes: notes || '',
      p_resource_id: resourceId || null,
      p_mobile_address: mobileAddress || null
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }

    return NextResponse.json({ success: true, updated: data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// GET: Fetch booking details by reference (for customer magic link management)
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const reference = url.searchParams.get('reference');
    const subdomain = url.searchParams.get('subdomain');

    if (!reference || !subdomain) {
      return NextResponse.json({ error: 'Missing reference or subdomain search parameters.' }, { status: 400 });
    }

    const client = serviceClient();

    // 1. Resolve tenant first
    const { data: tenant } = await client
      .from('tenants')
      .select('id, name')
      .eq('subdomain', subdomain.toLowerCase())
      .single();

    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found.' }, { status: 404 });
    }

    // 2. Fetch appointment details along with service & staff name
    const { data: appt, error } = await client
      .from('appointments')
      .select('id, start_time, end_time, status, notes, mobile_address, client_name, service_id, user_id, services(name, duration), users(name)')
      .eq('tenant_id', tenant.id)
      .eq('booking_reference', reference)
      .single();

    if (error || !appt) {
      return NextResponse.json({ error: 'Appointment not found.' }, { status: 404 });
    }

    // Return sanitized public booking details
    return NextResponse.json({
      id: appt.id,
      tenantId: tenant.id,
      tenantName: tenant.name,
      clientName: appt.client_name,
      serviceId: appt.service_id,
      serviceName: (appt.services as any)?.name || 'Service',
      serviceDuration: (appt.services as any)?.duration || 30,
      staffId: appt.user_id,
      staffName: (appt.users as any)?.name || 'Stylist',
      startTime: appt.start_time,
      endTime: appt.end_time,
      status: appt.status,
      notes: appt.notes,
      mobileAddress: appt.mobile_address
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
