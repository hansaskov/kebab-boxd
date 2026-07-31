import { DB_FILE_NAME } from "astro:env/server";
import { createDrizzleDatabase } from "@src/db";
import { defineMiddleware } from "astro:middleware";

const db = createDrizzleDatabase(DB_FILE_NAME);

export const onRequest = defineMiddleware((context, next) => {
	context.locals.db = db;
	return next();
});
