import { adminActions } from "@src/actions/admin";
import { profileActions } from "@src/actions/profile";
import { settingsActions } from "@src/actions/settings";

export const server = {
  ...settingsActions,
  admin: adminActions,
  profile: profileActions,
};
