import { getPool } from "../lib/db";

async function main() {
  const pool = getPool();
  await pool.query(`
    TRUNCATE
      push_tokens,
      reward_requests,
      rewards,
      chore_instances,
      chores,
      meals,
      sessions,
      display_pairings,
      settings,
      people
    RESTART IDENTITY CASCADE
  `);
  await pool.end();
  console.log("database emptied");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
