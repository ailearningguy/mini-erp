// Global test setup — runs before all tests
process.env.NODE_ENV = 'test';
process.env.DB_HOST = 'localhost';
process.env.DB_PORT = '5432';
process.env.DB_USER = 'postgres';
process.env.DB_PASSWORD = 'postgres';
process.env.DB_NAME = 'erp';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.RABBITMQ_URL = 'amqp://localhost:5672';
process.env.JWT_PUBLIC_KEY = 'test-public-key';
process.env.JWT_PRIVATE_KEY = 'test-private-key';
