/**
 * The host lost the backlog a client still needed. Domain stores reload from
 * the host and then call `completeRemoteResync` to reopen the event stream.
 */
export const RESYNC_REQUIRED_EVENT = "wavex://resync-required";
