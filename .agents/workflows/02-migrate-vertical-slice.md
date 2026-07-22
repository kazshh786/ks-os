# Migrate One Vertical Slice

For the requested feature:
1. Locate the proven business logic and data model in `01-current-next`.
2. Locate the desired UX in `02-redesign-vite`.
3. Write a concise feature contract: routes, permissions, inputs, outputs, tables, and edge cases.
4. Add shared Zod contracts.
5. Implement the API repository, service, and route layers.
6. Refactor the redesign into maintainable routed components.
7. Replace mock/localStorage access with the typed API client.
8. Add tests for business rules and tenant isolation.
9. Run type-check, tests, build, and browser verification.
10. Update migration and decision documentation.
