// Limits that both the forms and the database keep. They live apart from the schemas of the forms, which need Zod:
// the database imports them too, and the Durable Object would otherwise load all of Zod each time it wakes up.

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 30;

export const maxPicturesPerReview = 4;

// The links a User may have waiting in the SuggestionQueue at a time: enough to suggest a few restaurants in a row,
// too few to flood the queue.
export const maxQueuedPerUser = 5;

// A CitySearch is tried up to this many times while no Overpass server answers, and a place is looked up at Nominatim
// this many times before it is added with the address OpenStreetMap gave.
export const maxCitySearchAttempts = 5;
