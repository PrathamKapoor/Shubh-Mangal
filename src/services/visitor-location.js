/**
 * One-shot, user-action location; no watch, persistence, network, logging or URLs.
 * Freshness: timestamp must be nonnegative, at most 60s old and at most 5s ahead
 * of the injected clock. Request a new fix (maximumAge: 0), validate it anyway.
 * Accuracy >100m is an approximate display state, NOT a survey tolerance.
 * Even a successful fix cannot establish a parcel, ownership or survey position.
 */
const MAX_AGE_MS = 60_000;
const FUTURE_ALLOWANCE_MS = 5_000;
const REQUEST_TIMEOUT_MS = 12_000;
const APPROXIMATE_ACCURACY_M = 100;

const messages = {
  insecure: "Location requires a secure connection (HTTPS).",
  unsupported: "Location is not supported by this browser.",
  denied:
    "Location permission was denied. You can enable it in browser settings and try again.",
  unavailable: "Your location is unavailable. Please try again.",
  timeout: "The location request timed out. Please try again.",
  invalid:
    "The browser returned an invalid location measurement. Please try again.",
  stale:
    "The location timestamp is outside the freshness window. Please request a new location.",
  inaccurate:
    "Approximate location: reported accuracy is over 100 metres. This does not identify a parcel.",
};

function failure(status) {
  return { status, error: messages[status] };
}

function validCoordinates(lat, lng) {
  return (
    Number.isFinite(lat) &&
    lat >= -90 &&
    lat <= 90 &&
    Number.isFinite(lng) &&
    lng >= -180 &&
    lng <= 180
  );
}

/**
 * Validate a browser GeolocationPosition using a numeric epoch-ms clock value.
 * Returns {status, position?, error?}; position is a new, allowlisted object.
 * Only success/inaccurate carry coordinates; error is always fixed readable text.
 */
export function validatePosition(position, now = Date.now()) {
  const lat = position?.coords?.latitude;
  const lng = position?.coords?.longitude;
  const accuracy = position?.coords?.accuracy;
  const timestamp = position?.timestamp;
  if (
    !validCoordinates(lat, lng) ||
    !Number.isFinite(accuracy) ||
    accuracy < 0 ||
    !Number.isFinite(timestamp) ||
    timestamp < 0 ||
    !Number.isFinite(now) ||
    now < 0
  ) {
    return failure("invalid");
  }
  if (now - timestamp > MAX_AGE_MS || timestamp - now > FUTURE_ALLOWANCE_MS) {
    return failure("stale");
  }
  const sanitized = { lat, lng, accuracy, timestamp };
  return accuracy > APPROXIMATE_ACCURACY_M
    ? { ...failure("inaccurate"), position: sanitized }
    : { status: "success", position: sanitized };
}

/**
 * createLocationRequest({geolocation, secureContext, now=Date.now, onChange})
 * -> {request(), cancel()}.
 * Pass navigator.geolocation and window.isSecureContext explicitly. Construction
 * is silent; call request only from a user action. onChange receives requesting,
 * success, inaccurate, invalid, stale, denied, unsupported, insecure, timeout or
 * unavailable. Render status/error in the host's accessible live region.
 * cancel is silent for unmount cleanup; later explicit requests remain possible.
 * Browser one-shot requests cannot be aborted: cancellation invalidates callbacks
 * and clears our deadline. No position is retained by the controller.
 */
export function createLocationRequest({
  geolocation,
  secureContext,
  now = Date.now,
  onChange,
}) {
  let generation = 0;
  let timer;

  function cancel() {
    generation += 1;
    clearTimeout(timer);
    timer = undefined;
  }

  function request() {
    cancel();
    const token = generation;
    if (secureContext !== true) {
      onChange(failure("insecure"));
      return;
    }
    if (typeof geolocation?.getCurrentPosition !== "function") {
      onChange(failure("unsupported"));
      return;
    }

    function finish(state) {
      if (token !== generation) return;
      cancel(); // Settle and release resources before notifying a reentrant host.
      onChange(state);
    }

    onChange({ status: "requesting" });
    if (token !== generation) return;
    timer = setTimeout(() => finish(failure("timeout")), REQUEST_TIMEOUT_MS);
    try {
      geolocation.getCurrentPosition(
        (position) => {
          if (token !== generation) return;
          finish(validatePosition(position, now()));
        },
        (error) => {
          if (token !== generation) return;
          const status =
            error?.code === 1
              ? "denied"
              : error?.code === 3
                ? "timeout"
                : "unavailable";
          finish(failure(status));
        },
        {
          enableHighAccuracy: true,
          maximumAge: 0,
          timeout: REQUEST_TIMEOUT_MS,
        },
      );
    } catch {
      finish(failure("unavailable"));
    }
  }

  return { request, cancel };
}

/**
 * Classify a sanitized point against {west,south,east,north} (siteBounds shape).
 * Returns 'within-bounds', 'off-site', or 'unknown' for invalid inputs. Edges are
 * inclusive. This compares only the reported point to a rectangle, not its
 * accuracy circle or a parcel boundary; 'within-bounds' is no claim of presence.
 * Call only with a freshly validated position; this helper does not check age.
 * Wrapped/antimeridian and degenerate bounds are deliberately unsupported.
 */
export function locationRelativeToBounds(position, bounds) {
  if (
    !validCoordinates(position?.lat, position?.lng) ||
    !validCoordinates(bounds?.south, bounds?.west) ||
    !validCoordinates(bounds?.north, bounds?.east) ||
    bounds.west >= bounds.east ||
    bounds.south >= bounds.north
  )
    return "unknown";
  return position.lng >= bounds.west &&
    position.lng <= bounds.east &&
    position.lat >= bounds.south &&
    position.lat <= bounds.north
    ? "within-bounds"
    : "off-site";
}
