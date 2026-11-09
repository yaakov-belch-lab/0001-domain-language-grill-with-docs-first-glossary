import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import * as schema from "~/db/schema";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsFolder = path.resolve(__dirname, "../../drizzle");

/**
 * Creates a fresh in-memory SQLite database with all tables for testing.
 * Each call returns a new isolated database instance.
 *
 * Uses the same Drizzle migrations as the live database, ensuring
 * test and production schemas are always in sync.
 */
export function createTestDb(options: { stopBefore?: string } = {}) {
  const sqlite = new Database(":memory:");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  const testDb = drizzle(sqlite, { schema });

  migrate(testDb, {
    migrationsFolder: options.stopBefore
      ? migrationsBefore(options.stopBefore)
      : migrationsFolder,
  });

  return testDb;
}

export type TestDb = ReturnType<typeof createTestDb>;

/**
 * Applies every migration not yet applied. Pairs with
 * `createTestDb({ stopBefore })` to test a data migration against rows in the
 * shape that came before it.
 */
export function applyRemainingMigrations(testDb: TestDb) {
  migrate(testDb, { migrationsFolder });
}

// A copy of the migrations folder that ends just before the migration whose
// tag starts with `tag`.
function migrationsBefore(tag: string) {
  const journalPath = path.join(migrationsFolder, "meta", "_journal.json");
  const journal: { entries: { tag: string }[] } = JSON.parse(
    fs.readFileSync(journalPath, "utf8")
  );
  const stop = journal.entries.findIndex((e) => e.tag.startsWith(tag));
  if (stop === -1) throw new Error(`No migration tagged ${tag}`);

  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "migrations-"));
  fs.mkdirSync(path.join(folder, "meta"));
  const entries = journal.entries.slice(0, stop);
  fs.writeFileSync(
    path.join(folder, "meta", "_journal.json"),
    JSON.stringify({ ...journal, entries })
  );
  for (const entry of entries) {
    fs.copyFileSync(
      path.join(migrationsFolder, `${entry.tag}.sql`),
      path.join(folder, `${entry.tag}.sql`)
    );
  }
  return folder;
}

/**
 * Seeds a minimal set of base data (user, category, course) that most tests need.
 * Returns the created IDs for use in test assertions.
 */
export function seedBaseData(testDb: ReturnType<typeof createTestDb>) {
  const user = testDb
    .insert(schema.users)
    .values({
      name: "Test User",
      email: "test@example.com",
      role: schema.UserRole.Student,
    })
    .returning()
    .get();

  const instructor = testDb
    .insert(schema.users)
    .values({
      name: "Test Instructor",
      email: "instructor@example.com",
      role: schema.UserRole.Instructor,
    })
    .returning()
    .get();

  const category = testDb
    .insert(schema.categories)
    .values({ name: "Programming", slug: "programming" })
    .returning()
    .get();

  const course = testDb
    .insert(schema.courses)
    .values({
      title: "Test Course",
      slug: "test-course",
      description: "A test course",
      salesCopy: "## Test Course\n\nSales copy for the test course.",
      instructorId: instructor.id,
      categoryId: category.id,
      status: schema.CourseStatus.Published,
    })
    .returning()
    .get();

  return { user, instructor, category, course };
}
