/**
 * Copyright (c) 2017-present, blockcollider.org developers, All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow-disable
 */
const { resolve } = require('path')
const rimraf = require('rimraf')

const { RocksDb } = require('../')

const TEST_DATA_DIR = resolve(__filename, '..', '..', '..', '_data_test')

describe.skip('RocksDb', () => {
  it('can instantiate self', () => {
    expect(new RocksDb()).toBeInstanceOf(RocksDb)
  })

  test('get', done => {
    const dataDir = `${TEST_DATA_DIR}_get`
    const db = new RocksDb(dataDir)
    const key = 'key'
    const value = 'value'

    db.open()
      .then(() => {
        return db.put(key, value)
      })
      .then(() => {
        return db.get('key')
      })
      .then((res) => {
        expect(res).toEqual(value)
        done()
      })
  })

  test('get (bulk)', done => {
    const dataDir = `${TEST_DATA_DIR}_get_bulk`
    const db = new RocksDb(dataDir)

    const nums = [...Array(100)].map((v, i) => i)
    db.open()
      .then(() => {
        const promises = nums.map((num) => db.put(num, num))
        return Promise.all(promises)
      })
      .then(() => {
        const promises = nums.map((num) => db.get(num))
        return Promise.all(promises)
      })
      .then((res) => {
        nums.forEach((val, index) => {
          expect(val).toEqual(res[index])
        })
        done()
      })
  })

  test('get (bulk array)', done => {
    const dataDir = `${TEST_DATA_DIR}_get_bulk_array`
    const db = new RocksDb(dataDir)

    const nums = [...Array(100)].map((v, i) => i)
    db.open()
      .then(() => {
        const promises = nums.map((num) => db.put(num, num))
        return Promise.all(promises)
      })
      .then(() => {
        return db.getBulk(nums)
      })
      .then((res) => {
        nums.forEach((val, index) => {
          expect(val).toEqual(res[index])
        })
        done()
      })
  })

  test('get (bulk array) missing', done => {
    const dataDir = `${TEST_DATA_DIR}_get_bulk_missing`
    const db = new RocksDb(dataDir)

    const vals = [1, 2]
    db.open()
      .then(() => {
        const promises = vals.map((val) => db.put(val, val))
        return Promise.all(promises)
      })
      .then(() => {
        return db.getBulk([...vals, 3])
      })
      .then((res) => {
        vals.forEach((val, index) => {
          expect(val).toEqual(res[index])
        })
        done()
      })
  })

  test('get (bulk array) missing', done => {
    const dataDir = `${TEST_DATA_DIR}_get_bulk_array_missing`
    const db = new RocksDb(dataDir)

    const vals = [1, 2]
    db.open()
      .then(() => {
        const promises = vals.map((val) => db.put(val, val))
        return Promise.all(promises)
      })
      .then(() => {
        const promises = vals.map((num) => db.get(num))
        return Promise.all(promises)
      })
      .then((res) => {
        vals.forEach((val, index) => {
          expect(val).toEqual(res[index])
        })
        done()
      })
  })

  test('put', done => {
    const dataDir = `${TEST_DATA_DIR}_put`
    const db = new RocksDb(dataDir)

    const key = 'msg'
    const value = 'hello'

    db.open()
      .then(() => db.put(key, value))
      .then(() => db.get(key))
      .then((res) => {
        expect(res).toEqual(value)
        return db.del(key)
      })
      .then((res) => {
        expect(res).toEqual(true)
        return db.close()
      })
      .then(() => {
        done()
      })
      .catch((err) => {
        expect(err).toEqual(null)
      })
  })

  afterAll(done => {
    rimraf(`${TEST_DATA_DIR}*`, () => {
      done()
    })
  })
})
