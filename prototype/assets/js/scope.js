// Station scope: "All stations" (Owner only) or one specific station.
// Persisted per-user -- a bare, un-namespaced key would mean a second
// person signing in on the same browser inherits the first person's
// station choice, and every query would then silently return the wrong
// (or empty) data with no error to explain why.
import { listStations } from './data.js';

const STORAGE_PREFIX = 'demo_csv.scope.';

let _stations = [];
let _current = { mode: 'all', stationId: null };
let _userId = null;
const _listeners = [];

function storageKey() {
  return STORAGE_PREFIX + (_userId || 'anon');
}

export async function init(userId, { isOwner } = {}) {
  _userId = userId;
  _stations = await listStations();

  const persisted = localStorage.getItem(storageKey());

  if (persisted && persisted !== 'all' && _stations.some((s) => s.id === persisted)) {
    _current = { mode: 'station', stationId: persisted };
  } else if (persisted === 'all' && isOwner) {
    _current = { mode: 'all', stationId: null };
  } else if (isOwner) {
    _current = { mode: 'all', stationId: null };
  } else if (_stations.length > 0) {
    _current = { mode: 'station', stationId: _stations[0].id };
  } else {
    _current = { mode: 'all', stationId: null };
  }

  return current();
}

export function stations() {
  return _stations;
}

export function current() {
  const station = _current.stationId ? _stations.find((s) => s.id === _current.stationId) : null;
  return { ..._current, station };
}

export function set(stationIdOrAll) {
  _current = stationIdOrAll === 'all'
    ? { mode: 'all', stationId: null }
    : { mode: 'station', stationId: stationIdOrAll };
  localStorage.setItem(storageKey(), stationIdOrAll);
  const value = current();
  _listeners.forEach((cb) => cb(value));
}

export function onChange(cb) {
  _listeners.push(cb);
}
