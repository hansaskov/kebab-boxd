// What the pages share with suggestion-queue.db.ts, which the Web Worker cannot load.

// The links a User may have waiting in the SuggestionQueue at a time: enough to suggest a few restaurants in a row,
// too few to flood the queue.
export const maxQueuedPerUser = 5;
