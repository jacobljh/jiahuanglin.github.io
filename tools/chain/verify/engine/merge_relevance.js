#!/usr/bin/env node
'use strict';
/* merge_relevance.js — copies lesson 4's measured shelf-life table into the ledger:  LG.TABLE.relevance = SL.table()
 *   node tools/chain/verify/engine/merge_relevance.js          (rewrites the TABLE block of all_lessons/embodied_training_data_new/ledger.js)
 * shelf_lab.js holds the measurements (built by build_shelf.js); the ledger only carries the small summary the later lessons read.
 * build_ledger.js keeps an existing `relevance` block when it rebuilds the rest of the table. */
const fs = require('fs'), path = require('path');
const LESS = path.resolve(__dirname, '../../../../all_lessons');
const DD = fs.existsSync(path.join(LESS, 'embodied_training_data_new')) ? 'embodied_training_data_new' : 'embodied_training_data';
const LEDGER = path.join(LESS, DD, 'ledger.js'), SHELF = path.join(LESS, DD, 'shelf_lab.js');
const BEGIN = '/*TABLE:BEGIN*/', END = '/*TABLE:END*/';
const LG = require(LEDGER), SL = require(SHELF), rel = SL.table();
if (!rel) { console.error('shelf_lab.js has no stored table yet (run build_shelf.js)'); process.exit(1); }
const tab = JSON.parse(JSON.stringify(LG.TABLE)); tab.relevance = rel;
const src = fs.readFileSync(LEDGER, 'utf8'), a = src.indexOf(BEGIN), b = src.indexOf(END);
if (a < 0 || b < 0) throw new Error('ledger.js has no TABLE markers');
fs.writeFileSync(LEDGER, src.slice(0, a + BEGIN.length) + '\nLG.TABLE = ' + JSON.stringify(tab) + ';\n' + src.slice(b));
console.log('relevance merged:', JSON.stringify(rel).length, 'bytes; keys', Object.keys(rel).join(','));
