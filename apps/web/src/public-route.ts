export function normalisePublicPath(pathname: string): string {
  return pathname.replace(/\/+$/, '') || '/';
}

export function isPublicSitePath(pathname: string): boolean {
  const path = normalisePublicPath(pathname);
  return path === '/' || path === '/about' || path === '/packages' || path === '/services' || path.startsWith('/services/');
}
