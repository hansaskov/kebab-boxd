// What the pages share with city-searches.db.ts, which the Web Worker cannot load.

// A CitySearch is tried up to this many times while no Overpass server answers, and a place is looked up at Nominatim
// this many times before it is added with the address OpenStreetMap gave.
export const maxCitySearchAttempts = 5;
