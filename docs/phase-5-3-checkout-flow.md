# Phase 5.3 Checkout Flow

## Overview
This document outlines the end-to-end checkout flow for public bookings using Stripe Checkout.

## Step-by-Step Flow

1. **User Action**: The customer selects a service, a staff member, a time slot, and fills in their details.
2. **API Request**: The frontend makes a `POST /api/v1/public/:subdomain/bookings` request containing the booking details.
3. **Validation & Hold**: The backend validates the availability. If the slot is available, it inserts a booking record with status `PENDING_PAYMENT`. The slot is now pessimistically locked from other users.
4. **Checkout Session Creation**: The backend calls the Stripe API to create a Checkout Session, passing `metadata.bookingId` and associating the session with the tenant's Stripe Connected Account.
5. **Redirection**: The backend returns the `checkoutUrl` to the frontend, which redirects the user to the Stripe Checkout page.
6. **Payment Completion**: The user completes the payment on Stripe's hosted page. Stripe redirects the user back to the KS OS success URL.
7. **Webhook Fulfillment**: Stripe asynchronously sends a `checkout.session.completed` webhook to the backend, which confirms the booking and records the transaction.
8. **Expiration Handling**: If the user abandons the checkout, Stripe eventually expires the session and sends a `checkout.session.expired` webhook. The backend then marks the booking as `EXPIRED` or `CANCELLED`, unlocking the slot for others.
