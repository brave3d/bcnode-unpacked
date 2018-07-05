#! /usr/bin/env node

/**
 * Copyright (c) 2017-present, blockcollider.org developers, All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
const process = require('process')
const { merge } = require('ramda')
const logging = require('../../logger')

const globalLog = logging.getLogger(__filename)
// setup logging of unhandled rejections
process.on('unhandledRejection', (err) => {
  // $FlowFixMe
  globalLog.error(`Rejected promise, trace:\n${err.stack}`)
})

const Controller = require('./controller').default
const { config } = require('../../config')

const ROVER_TITLE = 'bc-rover-neo'
const IS_STANDALONE = require.main === module

/**
 * NEO Rover entrypoint
 */
const main = () => {
  process.title = ROVER_TITLE

  const controller = new Controller(merge(config, { isStandalone: IS_STANDALONE }))
  controller.init()
}

main()
