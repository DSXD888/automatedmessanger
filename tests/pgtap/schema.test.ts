import schemaSql from "./schema.sql" with { type: "text" };

Deno.test("pgTAP schema SQL is wired for the expected contract", () => {
  if (!schemaSql.includes("select plan(50);")) {
    throw new Error("pgTAP schema test must keep its plan count explicit");
  }
  if (!schemaSql.includes("select * from finish();")) {
    throw new Error("pgTAP schema test must call finish()");
  }
  if (!schemaSql.includes("rollback;")) {
    throw new Error("pgTAP schema test must roll back local test data");
  }
});

Deno.test("pgTAP schema contract", async () => {
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
  await writer.write(new TextEncoder().encode(schemaSql));
  await writer.close();

  const output = await process.output();
  const stdout = new TextDecoder().decode(output.stdout);
  const stderr = new TextDecoder().decode(output.stderr);
  const combined = `${stdout}\n${stderr}`;

  if (output.code !== 0) {
    throw new Error(`pgTAP exited with ${output.code}\n${combined}`);
  }
  if (!stdout.includes("1..50")) {
    throw new Error(`pgTAP plan was not emitted\n${combined}`);
  }
  if (combined.includes("not ok") || combined.includes("failed")) {
    throw new Error(`pgTAP reported a failure\n${combined}`);
  }
});
