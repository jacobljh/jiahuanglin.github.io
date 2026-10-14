// proto/_psy.js — load the REAL psy.js helpers (PSY.rng, PSY.gauss, PSY.phi, PSY.probit, PSY.mean/sd/corr) into node so a proto uses exactly the widget's random numbers.
var fs = require('fs'), vm = require('vm'), path = require('path');
var code = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'all_lessons', 'psychology', 'lessons', 'psy.js'), 'utf8');
var ctx = {}; ctx.window = ctx; vm.runInNewContext(code, ctx);
module.exports = ctx.PSY;
