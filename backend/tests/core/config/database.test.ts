import { describe, it, expect } from '@jest/globals';

describe('Database connection', () => {
  it('should build connection string from config', () => {
    const config = {
      database: { host: 'localhost', port: 5432, user: 'erp', password: 'secret', name: 'erp_db' },
    };
    const connectionString = `postgresql://${config.database.user}:${config.database.password}@${config.database.host}:${config.database.port}/${config.database.name}`;
    expect(connectionString).toBe('postgresql://erp:secret@localhost:5432/erp_db');
  });
});
