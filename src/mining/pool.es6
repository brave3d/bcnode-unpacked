/*
 * Copyright (c) 2017-present, Block Collider developers, All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

/* eslint-disable */
import type { Logger } from 'winston'
import type { PubSub } from '../engine/pubsub'
import type { RocksDb } from '../persistence'

const os = require('os')
const { fork, ChildProcess } = require('child_process')
const { writeFileSync } = require('fs')
const { resolve } = require('path')
const { inspect } = require('util')
const { config } = require('../config')
const { EventEmitter } = require('events')
const low = require('lowdb')
const FileAsync = require('lowdb/adapters/FileAsync')

const BN = require('bn.js')
const debug = require('debug')('bcnode:mining:officer')
const crypto = require('crypto')
const { repeat, mean, all, equals, flatten, fromPairs, last, range, values } = require('ramda')

const { prepareWork, prepareNewBlock, getUniqueBlocks } = require('./primitives')
const { getLogger } = require('../logger')
const { Block, BcBlock, BlockchainHeaders } = require('../protos/core_pb')
const { isDebugEnabled, ensureDebugPath } = require('../debug')
const { validateRoveredSequences, isValidBlock } = require('../bc/validation')
const { getBlockchainsBlocksCount } = require('../bc/helper')
const ts = require('../utils/time').default // ES6 default export

const MINER_WORKER_PATH = resolve(__filename, '..', '..', 'mining', 'thread.js')
const LOW_HEALTH_NET = process.env.LOW_HEALTH_NET === 'true'

type UnfinishedBlockData = {
  lastPreviousBlock: ?BcBlock,
  block: ?Block,
  currentBlocks: ?{ [blokchain: string]: Block },
  iterations: ?number,
  timeDiff: ?number
}

const keyOrMethodToChain = (keyOrMethod: string) => keyOrMethod.replace(/^get|set/, '').replace(/List$/, '').toLowerCase()
// const chainToSet = (chain: string) => `set${chain[0].toUpperCase() + chain.slice(1)}List` // UNUSED
const chainToGet = (chain: string) => `get${chain[0].toUpperCase() + chain.slice(1)}List`

export class WorkerPool {
  _logger: Logger
  _session: string
  _minerKey: string
  _pubsub: PubSub
  _persistence: RocksDb
  _timers: Object
  _timerResults: Object
  _knownRovers: string[]
  _emitter: EventEmitter
  _workers: Object
  _db: Object
  _maxWorkers: number
  _initialized: boolean
  _startupCheck: boolean
  _outbox: Object
  _heartbeat: Object

  _collectedBlocks: { [blockchain: string]: number }

  constructor (pubsub: PubSub, persistence: RocksDb, opts: { minerKey: string, rovers: string[] }) {
    const procGuardPathGlobalBase = process.env.BC_DATA_DIR || config.persistence.path
    let maxWorkers = os.cpus().length
		if(opts.maxWorkers !== undefined){
			maxWorkers = opts.maxWorkers
		}
    this._initialized = false
    this._logger = getLogger(__filename)
    this._session = crypto.randomBytes(32).toString('hex')
    this._minerKey = opts.minerKey
    this._pubsub = pubsub
    this._persistence = persistence
    this._knownRovers = opts.rovers
    this._poolGuardPath = opts.poolguard || procGuardPathGlobalBase + '/worker_pool_guard.json'
    this._maxWorkers = maxWorkers
    this._emitter = new EventEmitter()
    this._startupCheck = false
    this._heartbeat = {}
    this._outbox = new EventEmitter()
    this._workers = {}
  }

  get persistence (): RocksDb {
    return this._persistence
  }

  get pubsub (): PubSub {
    return this._pubsub
  }

  async init (): boolean {
    const db = new FileAsync(this._poolGuardPath)
    this._db = await low(db)
    const state = await this._db.getState()
    if(state !== undefined && state.workers !== undefined) {
      this._logger.info('cleaning previous work pool session ' + state.session + ' created on ' + state.timestamp)
      if(Object.keys(state.workers).length > 0){
        await this._closeWaywardWorkers(state.workers)
      }
    }
    const newState = {
      session: this._session,
      timestamp: new Date(),
      workers: []
    }
    await this._db.setState(newState).write()
    await this._db.set('workers', []).write()
		this._initialized = true
    this._logger.info('work pool initialized with session ' + this._session)
		return true
  }

  /*
   * Boot workers
   */
  async allRise (): boolean {
    if (this._db === undefined || this._initialized === false) { throw new Error('pool must initialize before calling rise') }
    if (Object.keys(this._workers).length > 0) { throw new Error('unable to launch new worker pool if workers already exist') }

    for (let i = 0; i < this._maxWorkers; i++){
      const worker: ChildProcess = fork(MINER_WORKER_PATH)
      worker.on('message', this._handleWorkerMessage.bind(this))
      worker.on('error', this._handleWorkerError.bind(this))
      worker.on('exit', this._handleWorkerExit.bind(this))
			this._workers[worker.pid] = worker
			await this._db.get('workers').push({ pid: worker.pid }).write()
			worker.send({ id: this._messageId(worker.pid), type: 'heartbeat' })
	  }

		const dp = new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				reject(new Error('unable to deploy workers in pool'))
			}, 10000)
			this._emitter.once('ready', () => {
  			clearTimeout(timeout)
			  resolve(true)
			})
		})

		return dp

  }

  allDismissed (): Promise<*> {
    return Promise.all(Object.keys(this._workers).map((w) => {
				return this.dismissWorker(this._workers[w])
		}))
  }

  _closeWaywardWorkers (staleWorkersObject: Object): Promise<*> {
     return Promise.all(
       Object.keys(staleWorkersObject).reduce((procs, pid) => {
          return new Promise((resolve, reject) => {
           ps.lookup({
             pid: pid,
             psargs: '-l'
           }, (err, results)  => {
              if(err) { reject(err) } else {
                 if(results.length < 1) {
                    return resolve(true)
                 } else {
                     const res = results[0]
                     console.log('test: '+res)
                     ps.kil(res.pid, { signal: 'SIGKILL', timeout: 5, psargs: '-l'}, (err) => {
                        if(err) { reject(err) } else {
                          resolve(true)
                        }
                     })
                 }
              }
           })
          })
          return proces
       }, []))
  }

  _sendMessageAsync (pid: number, msg: Object): Promise<*> {

    const id = this._messageId(pid)

    try {
      this._workers[pid].send(msg)
    } catch (err) {
      return Promise.reject(err)
    }

    const deferredPromise = new Promise((resolve, reject) => {
      this._emitter.once(id, (data) => {
        if(data !== undefined && data !== false){
          return resolve(data)
        }
       return resolve(false)
      })
    })

    this._outbox[id] = Math.floor(Date.now() * 0.001)

    return deferredPromise

  }

  updateWorkers (msg: Object): void {
		Object.keys(this._workers).map((pid) => {
			 this._workers[pid].send(msg)
		})
  }

  async dismissWorker (worker: Object): boolean {
    if (worker === undefined) {
      return Promise.resolve(true)
    }
    const pid = worker.pid
    worker = this._workers[worker.pid]

    if (!worker) {
      return true
    }

    if (worker.connected) {
      try {
        worker.disconnect()
      } catch (err) {
        this._logger.info(`unable to disconnect workerProcess, reason: ${err.message}`)
      }
    }


    try {
      worker.removeAllListeners()
    } catch (err) {
      this._logger.info(`unable to remove workerProcess listeners, reason: ${err.message}`)
    }

    // $FlowFixMe
    if (worker !== undefined && worker.killed !== true) {
      try {
        worker.kill()
        await this._db.get('workers').remove({ pid: pid }).write()
      } catch (err) {
        this._logger.info(`Unable to kill workerProcess, reason: ${err.message}`)
      }
    }

    return true

  }

  async _healthCheck (): boolean {
    try {
     const state  = await this._db.getState()
     let healthy = true
     if(state.session !== this._session){
        healthy = false
     }
     state.workers.map((worker) => {
       if(this._workers[worker.pid] === undefined) {
         healthy = false
       }
     })
     return healthy
    } catch(err) {
      this._logger.error(err)
    }
  }

  _messageId (pid: number) {
    return pid + '@' + crypto.randomBytes(16).toString('hex')
	}

  _scheduleNewWorker () {
    const worker: ChildProcess = fork(MINER_WORKER_PATH)
    worker.on('message', this._handleWorkerMessage.bind(this))
    worker.on('error', this._handleWorkerError.bind(this))
    worker.on('exit', this._handleWorkerExit.bind(this))
    table[worker.pid] = worker
    return table
  }

  _handleWorkerMessage (msg: Object) {
    if(msg === undefined || msg.id === undefined) {
      // strange unrequested feedback from worker
      // definately throw and likely exit
    } else if (msg.type === 'solution') {
      // handle block

    } else if (msg.type === 'heartbeat') {

      if(this._heartbeat[msg.pid] === undefined) {
				this._heartbeat[msg.pid] = Math.floor(Date.now() * 0.001)
			}

		  if(this._startupCheck === false){

				if(Object.keys(this._heartbeat).length === this._maxWorkers){
					this._startupCheck = true
          this._emitter.emit('ready')
			  }

			}

    } else if (this._outbox[msg.id] !== undefined) {
      this._logger.info('worker responded for ' + msg.id)
      delete this._outbox[msg.id]
      this._emitter.emit(msg.id, msg)
    } else {
      // message has no friends
    }
  }

  _handleWorkerError (msg: Object) {

  }

  _handleWorkerExit (exitCode: Object) {
		// worker ahs exited
  }

  sortBlocks (list: Object[]): Object[] {
    return list.sort((a, b) => {
      if (a.getHeight() < b.getHeight()) {
        return 1
      }
      if (a.getHeight() > b.getHeight()) {
        return -1
      }
      return 0
    })
  }
}
