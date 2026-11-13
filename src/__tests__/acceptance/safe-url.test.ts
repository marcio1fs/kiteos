import { describe, expect, it, vi } from 'vitest';

vi.mock('node:dns/promises', () => ({ lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]) }));

import { validateExternalUrl, UnsafeUrlError } from '@/lib/safe-url';
import { lookup } from 'node:dns/promises';

describe('SSRF guard', () => {
  it('rejects loopback and private IPv4 literals', async () => {
    for (const url of ['https://127.0.0.1/x', 'https://10.0.0.5/x', 'https://192.168.1.1/x', 'https://169.254.169.254/latest/meta-data']) {
      await expect(validateExternalUrl(url)).rejects.toBeInstanceOf(UnsafeUrlError);
    }
  });

  it('rejects localhost and credential-bearing URLs', async () => {
    await expect(validateExternalUrl('https://localhost/x')).rejects.toThrow();
    await expect(validateExternalUrl('https://user:pass@example.com/x')).rejects.toThrow(/credenciais/);
  });

  it('rejects non-HTTPS in production', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    await expect(validateExternalUrl('http://example.com/x')).rejects.toThrow(/HTTPS/);
    process.env.NODE_ENV = prev;
  });

  it('rejects hostnames that resolve to private addresses', async () => {
    vi.mocked(lookup).mockResolvedValueOnce([{ address: '10.1.2.3', family: 4 }] as never);
    await expect(validateExternalUrl('https://evil.example.com/x')).rejects.toThrow(/privada/);
  });

  it('accepts a public HTTPS endpoint and returns the pinned address', async () => {
    const result = await validateExternalUrl('https://api.z-api.io/instances/1/token/2/status');
    expect(result.address).toBe('93.184.216.34');
    expect(result.url.hostname).toBe('api.z-api.io');
  });
});
