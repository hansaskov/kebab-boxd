import { adminActions } from "@src/actions/admin";
import { notificationActions } from "@src/actions/notifications";
import { profileActions } from "@src/actions/profile";
import { restaurantActions } from "@src/actions/restaurants";
import { reviewActions } from "@src/actions/reviews";
import { sessionActions } from "@src/actions/session";
import { settingsActions } from "@src/actions/settings";

export const server = {
  ...settingsActions,
  admin: adminActions,
  notifications: notificationActions,
  profile: profileActions,
  restaurants: restaurantActions,
  reviews: reviewActions,
  session: sessionActions,
};
