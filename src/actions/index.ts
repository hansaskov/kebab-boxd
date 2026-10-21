import { adminActions } from "@src/actions/admin";
import { settingsActions } from "@src/actions/settings";

export const server = {
  ...settingsActions,
  admin: adminActions,
};
