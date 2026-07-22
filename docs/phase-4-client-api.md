# Phase 4.1 Client API Documentation

## Endpoints

### 1. `GET /api/v1/clients`
Returns a paginated list of clients for the authenticated tenant.
**Query Parameters:**
- `page` (optional): The page number to retrieve. Defaults to 1.
- `limit` (optional): The number of clients to retrieve per page. Defaults to 50, maximum 100.
- `search` (optional): A string to search across `name`, `email`, and `phone`.

**Response Contract:**
- `data`: Array of client objects containing `id`, `name`, `email`, `phone`, `lastVisitDate`, `upcomingBookingCount`, and `totalBookingCount`.
- `meta`: Pagination metadata containing `total`, `page`, `limit`, and `totalPages`.

### 2. `GET /api/v1/clients/:id`
Returns detailed profile and booking history for a specific client.
**Path Parameters:**
- `id`: The UUID of the client.

**Response Contract:**
- `profile`: Safe client profile object (no sensitive PII beyond contact info).
- `bookingHistory`: Array of tenant-scoped bookings containing `serviceName`, `staffName`, `startTime`, `endTime`, `status`, and `price`.
- `medicalNotes`: String containing medical notes (only returned if requester is an `owner`, otherwise `null`).

## Pagination & Search
- **Pagination:** Offset-based pagination is implemented on the directory endpoint utilizing `limit` and `offset = (page - 1) * limit`.
- **Search:** Case-insensitive search (`ilike`) matches against `name`, `email`, or `phone`. This is handled securely using parameterized Drizzle queries.

## Unresolved Schema & Index Requirements
- **Indexes:** Searching currently utilizes `ilike` across multiple columns. As the client database grows, this will result in full-table scans. We need to introduce trigram indexes (`pg_trgm`) or a dedicated full-text search column (`tsvector`) for `name`, `email`, and `phone` to maintain performance.
- **Keyset Pagination:** The directory currently uses offset pagination. This can become slow for very deep pages (e.g., page 10,000). A refactor to keyset (cursor-based) pagination using the `updatedAt` or `id` columns is recommended for long-term scalability.
