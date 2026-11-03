import { adminActions } from "@src/actions/admin";
import { profileActions } from "@src/actions/profile";
import { restaurantActions } from "@src/actions/restaurants";
import { reviewActions } from "@src/actions/reviews";
import { sessionActions } from "@src/actions/session";
import { settingsActions } from "@src/actions/settings";

export const server = {
  ...settingsActions,
  admin: adminActions,
  profile: profileActions,
  restaurants: restaurantActions,
  reviews: reviewActions,
  session: sessionActions,
};
