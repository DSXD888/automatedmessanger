import definerSql from "./definer.sql" with { type: "text" };
import concurrencySql from "./concurrency.sql" with { type: "text" };
import grantsSql from "./grants.sql" with { type: "text" };
import goLiveSql from "./go_live.sql" with { type: "text" };
import maintenanceSql from "./maintenance.sql" with { type: "text" };
import rlsSql from "./rls.sql" with { type: "text" };
import schemaSql from "./schema.sql" with { type: "text" };

const pgTapScripts = [
  { name: "schema", sql: schemaSql, plan: "52" },
  { name: "grants", sql: grantsSql, plan: "43" },
  { name: "rls", sql: rlsSql, plan: "8" },
  { name: "definer", sql: definerSql, plan: "14" },
  { name: "concurrency", sql: concurrencySql, plan: "40" },
  { name: "maintenance", sql: maintenanceSql, plan: "31" },
  { name: "go_live", sql: goLiveSql, plan: "11" },
];

Deno.test("pgTAP SQL is wired for the expected contracts", () => {
  for (const script of pgTapScripts) {
    if (!script.sql.includes(`select plan(${script.plan});`)) {
      throw new Error(
        `${script.name} pgTAP test must keep its plan count explicit`,
      );
    }
    if (!script.sql.includes("select * from finish();")) {
      throw new Error(`${script.name} pgTAP test must call finish()`);
    }
    if (!script.sql.includes("rollback;")) {
      throw new Error(
        `${script.name} pgTAP test must roll back local test data`,
      );
    }
  }
});

Deno.test("pgTAP data-layer contracts", async (testContext) => {
  const runPermission = await Deno.permissions.query({
    name: "run",
    command: "docker",
  });

  if (runPermission.state !== "granted") {
    console.warn(
      "Skipping executable pgTAP run; rerun with --allow-run=docker to execute it.",
    );
    return;
  }

  for (const script of pgTapScripts) {
    await testContext.step(script.name, async () => {
      await runPgTapScript(script.sql, script.plan);
    });
  }
});

async function runPgTapScript(sql: string, plan: string) {
  const process = new Deno.Command("docker", {
    args: [
      "exec",
      "-i",
      "supabase_db_automatedmessanger",
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();

  const writer = process.stdin.getWriter();
  await writer.write(new TextEncoder().encode(sql));
  await writer.close();

  const output = await process.output();
  const stdout = new TextDecoder().decode(output.stdout);
  const stderr = new TextDecoder().decode(output.stderr);
  const combined = `${stdout}\n${stderr}`;

  if (output.code !== 0) {
    throw new Error(`pgTAP exited with ${output.code}\n${combined}`);
  }
  if (!stdout.includes(`1..${plan}`)) {
    throw new Error(`pgTAP plan was not emitted\n${combined}`);
  }
  if (combined.includes("not ok") || combined.includes("failed")) {
    throw new Error(`pgTAP reported a failure\n${combined}`);
  }
}
