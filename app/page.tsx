import React from 'react';

export default function LandingPage() {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      padding: '40px 20px',
      background: 'radial-gradient(circle at top, #1e293b 0%, #0f172a 100%)',
      color: '#ffffff',
      textAlign: 'center'
    }}>
      <div style={{
        maxWidth: '640px',
        background: 'rgba(255, 255, 255, 0.03)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: '16px',
        padding: '48px 32px',
        backdropFilter: 'blur(20px)',
        boxShadow: '0 20px 50px rgba(0, 0, 0, 0.3)'
      }}>
        <span style={{
          background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
          color: '#ffffff',
          fontSize: '11px',
          fontWeight: 800,
          textTransform: 'uppercase',
          padding: '6px 14px',
          borderRadius: '9999px',
          letterSpacing: '1px',
          display: 'inline-block',
          marginBottom: '24px'
        }}>
          KS Studio Enterprise
        </span>
        
        <h1 style={{
          fontSize: '36px',
          fontWeight: 800,
          letterSpacing: '-1px',
          margin: '0 0 12px 0',
          background: 'linear-gradient(to right, #ffffff, #94a3b8)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent'
        }}>
          Lean Salon Growth OS
        </h1>
        
        <p style={{
          color: '#94a3b8',
          fontSize: '15px',
          lineHeight: 1.6,
          margin: '0 0 32px 0'
        }}>
          Enterprise Booking, checkout POS, CRM, and Digital Loyalty ledger for local clinics and salon chains. Securely isolated by Postgres tenant RLS.
        </p>

        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          alignItems: 'stretch'
        }}>
          <a
            href="/admin/onboard"
            style={{
              background: '#ffffff',
              color: '#0f172a',
              textDecoration: 'none',
              padding: '14px 20px',
              borderRadius: '8px',
              fontWeight: 700,
              fontSize: '14px',
              transition: 'background-color 0.15s ease'
            }}
          >
            Launch Agency Onboarding Dashboard
          </a>

          <div style={{
            fontSize: '12px',
            color: '#64748b',
            borderTop: '1px solid rgba(255, 255, 255, 0.08)',
            paddingTop: '20px',
            marginTop: '12px',
            lineHeight: 1.5
          }}>
            To test your subdomains in development, access:<br />
            <code style={{ color: '#10b981', background: 'rgba(16, 185, 129, 0.08)', padding: '2px 6px', borderRadius: '4px', display: 'inline-block', marginTop: '6px' }}>
              http://[subdomain].localhost:3000
            </code>
          </div>
        </div>
      </div>
    </div>
  );
}
