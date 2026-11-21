import { readdirSync, readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import type { Client } from "@src/db/client";

const migrationsFolder = ".drizzle";

function statementsOf(migrationName: string) {
	const folder = readdirSync(migrationsFolder).find((name) => name.endsWith(`_${migrationName}`));
	if (!folder) throw new Error(`There is no migration named ${migrationName}.`);
	return readFileSync(`${migrationsFolder}/${folder}/migration.sql`, "utf8")
		.split("--> statement-breakpoint")
		.map((statement) =>
			statement
				.split("\n")
				.filter((line) => !line.startsWith("--"))
				.join("\n")
				.trim(),
		);
}

export function fillAgain(client: Client, migrationName: string) {
	const filling = statementsOf(migrationName).filter((statement) => /^(INSERT|UPDATE)\b/.test(statement));
	if (filling.length === 0) throw new Error(`The migration ${migrationName} fills nothing.`);
	for (const statement of filling) client.run(sql.raw(statement));
}
