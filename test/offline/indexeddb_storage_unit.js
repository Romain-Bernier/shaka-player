/**
 * @license
 * Copyright 2016 Google Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */


describe('IndexeddbStorageCell', () => {
  const IndexedDBUtils = shaka.test.IndexedDBUtils;
  const OfflineUtils = shaka.test.OfflineUtils;
  const Util = shaka.test.Util;

  const dbName = 'shaka-storage-cell-test';
  const dbVersion = 1;
  const segmentStore = 'segment-store';
  const manifestStore = 'manifest-store';

  const noop = () => {};

  /** @type {!Array.<shaka.extern.StorageCell>} */
  let cells = [];

  /** @type {!Array.<IDBDatabase>} */
  let connections = [];

  beforeEach(() => {
    cells = [];
    connections = [];
  });

  afterEach(async () => {
    // If the test did not run, then there will be no cells and no connections,
    // so we don't need to worry about checking if indexeddb is supported here.

    // Destroy the cells before killing any connections.
    await Promise.all(cells.map((cell) => cell.destroy()));
    for (const connection of connections) {
      connection.close();
    }
  });

  it('can add, get, and remove segments', checkAndRun(async () => {
    /** @type {!Array.<shaka.extern.SegmentDataDB>} */
    const segments = [
      OfflineUtils.createSegmentData([0]),
      OfflineUtils.createSegmentData([0, 1]),
      OfflineUtils.createSegmentData([0, 1, 2]),
    ];

    await IndexedDBUtils.deleteDB(dbName);
    const connection = await makeConnection();
    const cell = makeCell(connection);

    const keys = await cell.addSegments(segments);
    expect(keys).toBeTruthy();
    expect(keys.length).toBe(segments.length);

    const found = await cell.getSegments(keys);
    expect(found).toBeTruthy();
    expect(found.length).toBe(segments.length);
    OfflineUtils.expectSegmentToEqual(found[0], segments[0]);
    OfflineUtils.expectSegmentToEqual(found[1], segments[1]);
    OfflineUtils.expectSegmentToEqual(found[2], segments[2]);

    await cell.removeSegments(keys, noop);
    // The get should fail as there should be no entries under the keys
    // anymore.
    const expected = Util.jasmineError(new shaka.util.Error(
        shaka.util.Error.Severity.CRITICAL,
        shaka.util.Error.Category.STORAGE,
        shaka.util.Error.Code.KEY_NOT_FOUND,
        jasmine.any(String)));
    await expectAsync(cell.getSegments(keys)).toBeRejectedWith(expected);
  }));

  it('can add, get, and remove manifests', checkAndRun(async () => {
    /** @type {!Array.<shaka.extern.ManifestDB>} */
    const manifests = [
      OfflineUtils.createManifest('original-uri-1'),
      OfflineUtils.createManifest('original-uri-2'),
      OfflineUtils.createManifest('original-uri-3'),
    ];

    await IndexedDBUtils.deleteDB(dbName);
    const connection = await makeConnection();
    const cell = makeCell(connection);
    const keys = await cell.addManifests(manifests);
    expect(keys).toBeTruthy();
    expect(keys.length).toBe(manifests.length);

    const found = await cell.getManifests(keys);
    expect(found).toBeTruthy();
    expect(found.length).toBe(manifests.length);
    expect(found[0]).toEqual(manifests[0]);
    expect(found[1]).toEqual(manifests[1]);
    expect(found[2]).toEqual(manifests[2]);

    await cell.removeManifests(keys, noop);
    // The get should fail as there should be no entries under the keys
    // anymore.
    const expected = Util.jasmineError(new shaka.util.Error(
        shaka.util.Error.Severity.CRITICAL,
        shaka.util.Error.Category.STORAGE,
        shaka.util.Error.Code.KEY_NOT_FOUND,
        jasmine.any(String)));
    await expectAsync(cell.getManifests(keys)).toBeRejectedWith(expected);
  }));

  it('can add and get all manifests', checkAndRun(async () => {
    /** @type {!Array.<shaka.extern.ManifestDB>} */
    const manifests = [
      OfflineUtils.createManifest('original-uri-1'),
      OfflineUtils.createManifest('original-uri-2'),
      OfflineUtils.createManifest('original-uri-3'),
    ];

    await IndexedDBUtils.deleteDB(dbName);
    const connection = await makeConnection();
    const cell = await makeCell(connection);
    const keys = await cell.addManifests(manifests);
    expect(keys).toBeTruthy();
    expect(keys.length).toBe(manifests.length);

    const found = await cell.getAllManifests();
    expect(found).toBeTruthy();

    const actual = keys.map((key) => found.get(key));
    expect(actual[0]).toEqual(manifests[0]);
    expect(actual[1]).toEqual(manifests[1]);
    expect(actual[2]).toEqual(manifests[2]);
  }));

  it('can add, get, and update manifests', checkAndRun(async () => {
    /** @type {shaka.extern.ManifestDB} */
    const originalManifest = OfflineUtils.createManifest('original');
    originalManifest.expiration = 1000;

    await IndexedDBUtils.deleteDB(dbName);
    const connection = await makeConnection();
    const cell = await makeCell(connection);
    const keys = await cell.addManifests([originalManifest]);
    expect(keys).toBeTruthy();
    expect(keys.length).toBe(1);

    const key = keys[0];
    const found = await cell.getManifests(keys);
    expect(found).toBeTruthy();
    expect(found.length).toBe(1);
    expect(found[0]).toEqual(originalManifest);

    await cell.updateManifestExpiration(key, 500);
    const newFound = await cell.getManifests([key]);
    expect(newFound).toBeTruthy();
    expect(newFound.length).toBe(1);

    expect(newFound[0]).not.toEqual(originalManifest);
    originalManifest.expiration = 500;
    expect(newFound[0]).toEqual(originalManifest);
  }));

  /**
   * @return {!Promise.<IDBDatabase>}
   */
  async function makeConnection() {
    const upgrade = (db) => {
      db.createObjectStore(segmentStore, {autoIncrement: true});
      db.createObjectStore(manifestStore, {autoIncrement: true});
    };

    const connection =
        await IndexedDBUtils.makeConnection(dbName, dbVersion, upgrade);
    // Track the connection so that we can close it when the test is
    // over.
    connections.push(connection);
    return connection;
  }

  /**
   * @param {IDBDatabase} connection
   * @return {shaka.extern.StorageCell}
   */
  function makeCell(connection) {
    const cell = new shaka.offline.indexeddb.V2StorageCell(
        connection,
        segmentStore,
        manifestStore,
        false /* allow add operations */);

    // Track the cell so that we can destroy it when the test is over.
    cells.push(cell);

    return cell;
  }

  /**
   * Before running the test, check if indexeddb is support on this platform.
   *
   * @param {function():!Promise} test
   * @return {function(function())}
   */
  function checkAndRun(test) {
    return async () => {
      if (window.indexedDB) {
        await test();
      } else {
        pending('Indexeddb is not supported on this platform.');
      }
    };
  }
});
