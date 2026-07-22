import { DB_FILE_NAME } from "astro:env/server";
import { createDatabase } from "./db";
import { defineMiddleware } from "astro:middleware";

const db = createDatabase(DB_FILE_NAME);

export const onRequest = defineMiddleware((context, next) => {
	context.locals.db = db;
	return next();
});
