// Seed script — populates initial data for development
// Run: npm run seed

import { loadConfig } from '../src/core/config/config';

async function seed(): Promise<void> {
  const config = loadConfig();
  console.log('Seeding database...');

  // In real implementation:
  // const pool = new Pool({ connectionString: ... });
  // const db = drizzle(pool);

  // Insert sample products
  // await db.insert(products).values([
  //   { productName: 'Widget A', sku: 'WIDGET-A', basePrice: '10000', stock: 100 },
  //   { productName: 'Widget B', sku: 'WIDGET-B', basePrice: '25000', stock: 50 },
  //   { productName: 'Gadget X', sku: 'GADGET-X', basePrice: '150000', stock: 25 },
  // ]);

  console.log('Seed complete');
}

seed().catch((error) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
