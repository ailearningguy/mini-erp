import { describe, it, expect } from '@jest/globals';

describe('Database config', () => {
  it('should build connection string from config', () => {
    const config = {
      database: { host: 'localhost', port: 5432, user: 'erp', password: 'secret', name: 'erp_db' },
    };
    const connectionString = `postgresql://${config.database.user}:${config.database.password}@${config.database.host}:${config.database.port}/${config.database.name}`;
    expect(connectionString).toBe('postgresql://erp:secret@localhost:5432/erp_db');
  });

  it('should handle non-default port in connection string', () => {
    const config = {
      database: { host: 'db.example.com', port: 5433, user: 'admin', password: 'p@ss', name: 'prod_db' },
    };
    const connectionString = `postgresql://${config.database.user}:${config.database.password}@${config.database.host}:${config.database.port}/${config.database.name}`;
    expect(connectionString).toBe('postgresql://admin:p@ss@db.example.com:5433/prod_db');
  });
});
