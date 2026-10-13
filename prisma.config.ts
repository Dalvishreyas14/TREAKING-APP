import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// Prisma 7 keeps ALL CLI configuration here rather than in package.json or the
// schema. The datasource url deliberately lives in this file so that the schema
// stays free of connection strings.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
