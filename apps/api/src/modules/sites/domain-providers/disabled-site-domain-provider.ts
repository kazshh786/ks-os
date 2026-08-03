import {
  SiteDomainProviderError,
  type SiteDomainProvider,
} from './site-domain-provider.js';

export class DisabledSiteDomainProvider implements SiteDomainProvider {
  readonly key = 'CLOUDFLARE' as const;

  private fail(): never {
    throw new SiteDomainProviderError(
      503,
      'SITE_DOMAIN_PROVIDER_DISABLED',
      'Managed custom-domain operations are disabled on the API server.',
    );
  }

  async prepare(
    _input: Parameters<SiteDomainProvider['prepare']>[0],
  ): Promise<never> { return this.fail(); }

  async verify(
    _input: Parameters<SiteDomainProvider['verify']>[0],
  ): Promise<never> { return this.fail(); }
}
