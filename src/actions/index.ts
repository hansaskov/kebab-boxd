import { adminActions } from "@src/admin/actions";
import { profileActions } from "@src/follows/actions";
import { restaurantActions } from "@src/restaurants/actions";
import { reviewActions } from "@src/reviews/actions";
import { sessionActions } from "@src/auth/actions";
import { settingsActions } from "@src/settings/actions";

export const server = {
  ...settingsActions,
  admin: adminActions,
  profile: profileActions,
  restaurants: restaurantActions,
  reviews: reviewActions,
  session: sessionActions,
};
