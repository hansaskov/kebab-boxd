import { z } from "astro/zod";
import { reservedUsernames } from "@src/data/reserved-usernames";

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 30;
export const USERNAME_PATTERN_MESSAGE = "Use only letters A–Z or a–z, digits and underscores.";

export const usernameSchema = z
  .string()
  .min(USERNAME_MIN_LENGTH)
  .max(USERNAME_MAX_LENGTH)
  .regex(/^[A-Za-z0-9_]+$/, USERNAME_PATTERN_MESSAGE)
  .toLowerCase()
  .refine((username) => !reservedUsernames.has(username), "This username is reserved.");
