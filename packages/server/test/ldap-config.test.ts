import { describe, expect, it } from 'vitest';
import { ldapConfigAusEnv } from '../src/auth/ldap.js';

const basis = {
  LDAP_URL: 'ldaps://ldap.example.de:636',
  LDAP_BASE_DN: 'DC=SNRD,DC=local',
};

describe('ldapConfigAusEnv', () => {
  it('Service-Modus: verlangt LDAP_BIND_DN und LDAP_BIND_PW', () => {
    expect(() => ldapConfigAusEnv({ ...basis } as NodeJS.ProcessEnv)).toThrow(/LDAP_BIND_DN/);
    const cfg = ldapConfigAusEnv({
      ...basis,
      LDAP_BIND_DN: 'CN=svc,DC=SNRD,DC=local',
      LDAP_BIND_PW: 'geheim',
    } as NodeJS.ProcessEnv);
    expect(cfg.userBindTemplate).toBeUndefined();
    expect(cfg.bindDn).toBe('CN=svc,DC=SNRD,DC=local');
  });

  it('Direkt-Modus: Service-Account ist optional, Template wird übernommen', () => {
    const cfg = ldapConfigAusEnv({
      ...basis,
      LDAP_BIND_USER_TEMPLATE: 'SNRD\\{{username}}',
    } as NodeJS.ProcessEnv);
    expect(cfg.userBindTemplate).toBe('SNRD\\{{username}}');
    expect(cfg.bindDn).toBe('');
    expect(cfg.bindPasswort).toBe('');
  });

  it('TLS-Optionen: rejectUnauthorized=false wird gesetzt', () => {
    const cfg = ldapConfigAusEnv({
      ...basis,
      LDAP_BIND_USER_TEMPLATE: 'SNRD\\{{username}}',
      LDAP_TLS_REJECT_UNAUTHORIZED: 'false',
    } as NodeJS.ProcessEnv);
    expect(cfg.tlsOptions?.rejectUnauthorized).toBe(false);
  });

  it('Defaults für Filter/Attribute', () => {
    const cfg = ldapConfigAusEnv({
      ...basis,
      LDAP_BIND_USER_TEMPLATE: '{{username}}@snrd.local',
    } as NodeJS.ProcessEnv);
    expect(cfg.userFilter).toBe('(sAMAccountName={{username}})');
    expect(cfg.loginAttr).toBe('sAMAccountName');
    expect(cfg.nameAttr).toBe('displayName');
  });
});
