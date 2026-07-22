export class CustomerPortalError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'CustomerPortalError';
  }
}

export function customerError(statusCode: number, code: string, message: string) {
  return new CustomerPortalError(statusCode, code, message);
}
