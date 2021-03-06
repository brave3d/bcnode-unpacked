#! /usr/bin/env node

/**
 * Copyright (c) 2017-present, blockcollider.org developers, All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
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
const { DF_CONFIG } = require('../../bc/validation')

const ROVER_TITLE = 'bc-rover-wav'
const IS_STANDALONE = require.main === module && process.argv.length > 2

/**
 * WAV Rover entrypoint
 */
const main = () => {
  process.title = ROVER_TITLE

  const controller = new Controller(merge(config, { isStandalone: IS_STANDALONE, dfConfig: DF_CONFIG }))
  controller.init()
}

main()
