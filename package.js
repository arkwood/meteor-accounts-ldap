Package.describe({
  name: 'ilfrich:accounts-ldap',
  version: '1.0.0',
  summary: 'Accounts login handler for LDAP using ldapjs and allowing to search anonymously for the DN before binding.',
  git: 'https://github.com/ilfrich/meteor-accounts-ldap',
  documentation: 'README.md'
});

Npm.depends({
    'ldapjs': '1.0.0'
});

Package.onUse(function(api) {
    api.versionsFrom('1.3.1');

    api.use(['templating'], 'client');
    api.use(['accounts-base', 'check'], 'server');
    api.imply(['accounts-base', 'accounts-password']);

    api.mainModule('ldap_client.js', 'client');
    api.mainModule('ldap_server.js', 'server');

    api.export('LDAP', 'server');
    api.export('LDAP_DEFAULTS', 'server');
});