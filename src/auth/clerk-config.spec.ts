import { describe, expect, it } from '@jest/globals';

import { getClerkAuthorizedParties } from './clerk-config';

describe('getClerkAuthorizedParties', () => {
  it('adds localhost origins during development', () => {
    expect(getClerkAuthorizedParties({ NODE_ENV: 'development' })).toEqual([
      'http://localhost:3000',
      'http://localhost:3004',
    ]);
  });

  it('uses only configured HTTPS origins in production', () => {
    expect(
      getClerkAuthorizedParties({
        NODE_ENV: 'production',
        MAIN_WEBSITE_URL: 'https://propnexai.com/',
      }),
    ).toEqual(['https://propnexai.com']);
  });

  it('supports and deduplicates additional frontend origins', () => {
    expect(
      getClerkAuthorizedParties({
        NODE_ENV: 'production',
        MAIN_WEBSITE_URL: 'https://propnexai.com',
        CLERK_AUTHORIZED_PARTIES:
          'https://propnexai.com/, https://admin.propnexai.com',
      }),
    ).toEqual(['https://propnexai.com', 'https://admin.propnexai.com']);
  });

  it('rejects missing production frontend origins', () => {
    expect(() => getClerkAuthorizedParties({ NODE_ENV: 'production' })).toThrow(
      'MAIN_WEBSITE_URL or CLERK_AUTHORIZED_PARTIES must configure at least one production frontend origin',
    );
  });

  it('rejects insecure production frontend origins', () => {
    expect(() =>
      getClerkAuthorizedParties({
        NODE_ENV: 'production',
        MAIN_WEBSITE_URL: 'http://propnexai.com',
      }),
    ).toThrow('Production Clerk authorized parties must use https origins');
  });
});
