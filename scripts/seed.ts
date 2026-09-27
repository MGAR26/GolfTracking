import { getDb } from "../src/db/client";
import { seedDatabase } from "../src/db/seed";

getDb()
  .then(seedDatabase)
  .then((r) => {
    console.log(r.seeded ? "Seeded Pinehurst Trip 2026." : "Seed trip already exists; nothing to do.");
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
