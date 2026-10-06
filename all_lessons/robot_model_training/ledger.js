/* ledger.js — the data track's shared engine: a table of measured curves and a table of assumed prices.
 *
 * TABLE (measured on the Bench by tools/chain/verify/engine/build_ledger.js; never edit by hand) holds one success-versus-hours curve per (task, source):
 *   layouts  how many layouts the policy has seen (lessons 7 and 8): own demonstrations are the baseline; the other sources are added to 8 or 32 own layouts:
 *            twin  an arm of the same make, labelled in task space           old    an older arm from another laboratory, labelled in task space
 *            video footage of a person, the hand tracked in pixels            sim0.001 ... sim0.03  a simulator whose arm model is off by that fraction, joint angles as labels
 *            simH0.03  the 3 % simulator again, but with hand positions as labels (the gap in the arm model no longer matters)
 *            S = TABLE.layouts; S.N the own-layout grid; S.ownHand / S.ownJoint {N, s, lo, hi} the own-only curves in the two label spaces;
 *            S.src[key] = {name, space, gap, s, lo, hi, kept, rho}, each a map  base -> array over S.M  (attempted foreign layouts 0,4,...,256);
 *            rho[base][i] = (own layouts that give the same success - base) / attempted foreign layouts: the exchange rate at that operating point.
 *   recover  the five-post course (lessons 1 to 3): TABLE.recover.calm / g05 / g10 are own demonstrations recorded calm / under gust 0.05 / under gust 0.10 for
 *            n = TABLE.recover.n demonstrations ({n, frames, s, lo, hi, crashed}); TABLE.recover.corr is 20 calm demonstrations plus rounds of 5 runs of the
 *            clone, every visited frame relabelled by the expert ({rounds, frames, labelled, rollouts, s, lo, hi}).
 *   contact  a peg in a hole with 1 mm of clearance (lesson 10): TABLE.contact.withForce / noForce are clones trained on m = TABLE.contact.m demonstrations whose
 *            force channels were kept / dropped; .stiff and .yielding are the two hand-written policies; .secPerAttempt is the mean length of an attempt.
 *   relevance  how the value of corrections ages (lesson 19; measured by build_shelf.js, merged here by merge_relevance.js; the full table lives in shelf_lab.js).  gen = 0..5 is the number of rounds
 *            of corrections already stored when the clone was trained (0 = the clone of the 20 calm demonstrations); keep = the share of a correction set's value that survives a retraining, as the
 *            ledger books it (1: no decay was measured; keepSuccess and keepSmooth are the measured ratios by the age of the set in clones); valueByGen = success POINTS that a fresh set of 800
 *            labelled frames adds to the clone of that generation (the supply of failures to correct runs out: 18.5 -> 0.9); postsByGen = percent of that clone's runs that end in a post;
 *            successByGen = percent success of the clone when every demonstration and correction is stored; roundsOnlyByGen = percent success when the calm demonstrations are dropped and only the
 *            corrections are kept (from the third clone on; higher than successByGen, so TABLE.recover.corr understates what corrections alone reach); driftKeep = the value of a set made at
 *            gust ratio 1 / 1.5 / 2 of the gust the policy runs at, relative to a set made at the policy's own gust (sets made at a harsher gust are worth more: 'harsher'); framesPerRound = labelled
 *            frames in one round of five runs; notes = how each field is defined.
 * Success is a fraction in [0, 1], lo and hi its 95 % Wilson interval, over 200 rollouts (recover, contact) or 1000 test layouts (layouts).
 *
 * HOURS.  One demonstration is 9.3 s of motion, so an own-robot hour is 387.1 demonstrations (LG.UNIT).  Hours here are motion hours; wall-clock, resets and discards are
 * priced in lesson 17.  The Bench task is small, so its whole curve lives within an hour or two: exchange rates and cost ratios carry to larger tasks, the totals do not.
 *
 * ASSUMPTIONS (LG.assume) and LG.price(key, assume) give the price of one motion hour of each source in dollars.  Every number in LG.assume is an assumption, not a measurement
 * (no source prints a dollar cost per collected hour); lesson 17 argues each line and lets the reader move them, and every later lesson reads LG.assume unchanged.
 */
(function (root) {
'use strict';
var LG = {};
LG.UNIT = { secPerDemo: 9.3, demosPerHour: 3600 / 9.3 };
LG.hours = function (nDemos) { return nDemos * LG.UNIT.secPerDemo / 3600; };         // motion hours of that many attempted demonstrations
LG.demos = function (hours) { return hours * 3600 / LG.UNIT.secPerDemo; };

/*TABLE:BEGIN*/
LG.TABLE = {"unit":{"secPerDemo":9.3,"demosPerHour":387.1},"layouts":{"N":[1,2,4,8,12,16,24,32,48,64,96,128,192,256],"ownHand":{"N":[1,2,4,8,12,16,24,32,48,64,96,128,192,256],"s":[0.229,0.231,0.089,0.216,0.287,0.34,0.47,0.549,0.698,0.79,0.898,0.933,0.978,0.99],"lo":[0.204,0.2059,0.0729,0.1916,0.2598,0.3113,0.4392,0.518,0.6688,0.7637,0.8777,0.9158,0.9669,0.9817],"hi":[0.2561,0.2581,0.1083,0.2426,0.3158,0.3699,0.501,0.5796,0.7257,0.8141,0.9153,0.9469,0.9854,0.9946]},"ownJoint":{"N":[1,2,4,8,12,16,24,32,48,64,96,128,192,256],"s":[0.231,0.233,0.09,0.216,0.285,0.342,0.471,0.55,0.701,0.791,0.904,0.937,0.98,0.993],"lo":[0.2059,0.2079,0.0738,0.1916,0.2579,0.3133,0.4402,0.519,0.6719,0.7647,0.8842,0.9202,0.9693,0.9856],"hi":[0.2581,0.2602,0.1093,0.2426,0.3138,0.372,0.502,0.5806,0.7286,0.8151,0.9207,0.9505,0.987,0.9966]},"base":[8,32],"M":[0,4,8,16,32,64,128,256],"src":{"twin":{"name":"an arm of the same make, labelled in task space","space":"hand","gap":null,"s":{"8":[0.216,0.327,0.378,0.515,0.682,0.82,0.936,0.988],"32":[0.549,0.591,0.615,0.709,0.771,0.859,0.952,0.991]},"lo":{"8":[0.1916,0.2986,0.3485,0.484,0.6525,0.795,0.9191,0.9791],"32":[0.518,0.5602,0.5845,0.6801,0.7439,0.8361,0.9369,0.983]},"hi":{"8":[0.2426,0.3567,0.4085,0.5459,0.7101,0.8426,0.9496,0.9931],"32":[0.5796,0.6211,0.6447,0.7363,0.796,0.8792,0.9636,0.9953]},"kept":{"8":[0,4,8,16,32,64,128,256],"32":[0,4,8,16,32,64,128,256]},"rho":{"8":[null,1.7547,1.2923,1.2848,1.1963,1.0139,0.9708,0.9271],"32":[null,1.1275,0.8859,1.1196,0.8967,0.8194,0.9611,0.8958]}},"old":{"name":"an older arm from another laboratory, labelled in task space","space":"hand","gap":null,"s":{"8":[0.216,0.26,0.293,0.408,0.511,0.551,0.637,0.717],"32":[0.549,0.571,0.562,0.632,0.664,0.648,0.695,0.758]},"lo":{"8":[0.1916,0.2338,0.2656,0.3779,0.48,0.52,0.6067,0.6883],"32":[0.518,0.5401,0.5311,0.6017,0.6341,0.6179,0.6658,0.7305]},"hi":{"8":[0.2426,0.2881,0.322,0.4388,0.5419,0.5816,0.6662,0.744],"32":[0.5796,0.6013,0.5925,0.6613,0.6926,0.677,0.7227,0.7835]},"kept":{"8":[0,1,3,11,24,50,97,197],"32":[0,1,3,11,24,50,97,197]},"rho":{"8":[null,0.5179,0.5566,0.7615,0.6297,0.3784,0.2613,0.1692],"32":[null,0.5906,0.1745,0.557,0.3859,0.1661,0.1225,0.1033]}},"video":{"name":"footage of a person, hand tracked in pixels","space":"hand","gap":null,"s":{"8":[0.216,0.229,0.244,0.281,0.35,0.38,0.448,0.56],"32":[0.549,0.556,0.551,0.559,0.574,0.555,0.57,0.63]},"lo":{"8":[0.1916,0.204,0.2184,0.254,0.3211,0.3504,0.4174,0.5291],"32":[0.518,0.525,0.52,0.5281,0.5431,0.524,0.5391,0.5996]},"hi":{"8":[0.2426,0.2561,0.2716,0.3097,0.3801,0.4105,0.479,0.5905],"32":[0.5796,0.5865,0.5816,0.5895,0.6043,0.5855,0.6004,0.6594]},"kept":{"8":[0,1,3,9,20,41,89,180],"32":[0,1,3,9,20,41,89,180]},"rho":{"8":[null,-1.75,0.1161,0.2232,0.2692,0.1635,0.1144,0.0984],"32":[null,0.1879,0.0268,0.0671,0.0839,0.0101,0.0176,0.034]}},"sim0.001":{"name":"a simulator whose arm model is off by 0.1 %, joint angles as labels","space":"joint","gap":0.001,"s":{"8":[0.216,0.314,0.364,0.498,0.669,0.803,0.929,0.983],"32":[0.55,0.586,0.605,0.697,0.762,0.846,0.946,0.988]},"lo":{"8":[0.1916,0.286,0.3348,0.4671,0.6392,0.7772,0.9114,0.9729],"32":[0.519,0.5552,0.5744,0.6678,0.7346,0.8223,0.9302,0.9791]},"hi":{"8":[0.2426,0.3434,0.3943,0.5289,0.6975,0.8265,0.9433,0.9894],"32":[0.5806,0.6161,0.6348,0.7247,0.7874,0.867,0.9584,0.9931]},"kept":{"8":[0,4,8,16,32,64,128,256],"32":[0,4,8,16,32,64,128,256]},"rho":{"8":[null,1.5088,1.1705,1.1709,1.144,0.9281,0.8769,0.7764],"32":[null,0.9536,0.7285,0.9735,0.8389,0.7434,0.8547,0.7788]}},"sim0.003":{"name":"a simulator whose arm model is off by 0.3 %, joint angles as labels","space":"joint","gap":0.003,"s":{"8":[0.216,0.307,0.354,0.479,0.642,0.774,0.908,0.972],"32":[0.55,0.581,0.598,0.684,0.742,0.828,0.93,0.981]},"lo":{"8":[0.1916,0.2792,0.325,0.4482,0.6118,0.7471,0.8885,0.9598],"32":[0.519,0.5502,0.5673,0.6545,0.714,0.8034,0.9125,0.9705]},"hi":{"8":[0.2426,0.3363,0.3841,0.51,0.6711,0.7988,0.9244,0.9806],"32":[0.5806,0.6112,0.628,0.7121,0.7682,0.8501,0.9442,0.9878]},"kept":{"8":[0,4,8,16,32,64,128,256],"32":[0,4,8,16,32,64,128,256]},"rho":{"8":[null,1.386,1.093,1.0506,1.0546,0.8278,0.7178,0.6722],"32":[null,0.8212,0.6358,0.8874,0.7278,0.6637,0.697,0.6442]}},"sim0.01":{"name":"a simulator whose arm model is off by 1 %, joint angles as labels","space":"joint","gap":0.01,"s":{"8":[0.216,0.273,0.309,0.397,0.476,0.579,0.723,0.823],"32":[0.55,0.564,0.577,0.636,0.631,0.681,0.787,0.853]},"lo":{"8":[0.1916,0.2463,0.2811,0.3671,0.4452,0.5482,0.6944,0.7981],"32":[0.519,0.5331,0.5461,0.6057,0.6006,0.6515,0.7605,0.8297]},"hi":{"8":[0.2426,0.3014,0.3383,0.4277,0.507,0.6092,0.7498,0.8454],"32":[0.5806,0.5944,0.6073,0.6652,0.6604,0.7091,0.8113,0.8736]},"kept":{"8":[0,4,8,16,32,64,128,256],"32":[0,4,8,16,32,64,128,256]},"rho":{"8":[null,0.7692,0.7105,0.7132,0.5158,0.423,0.3431,0.2541],"32":[null,0.3709,0.3576,0.5695,0.2682,0.2169,0.2444,0.1936]}},"sim0.03":{"name":"a simulator whose arm model is off by 3 %, joint angles as labels","space":"joint","gap":0.03,"s":{"8":[0.216,0.214,0.199,0.189,0.146,0.125,0.084,0.058],"32":[0.55,0.517,0.493,0.464,0.376,0.292,0.206,0.142]},"lo":{"8":[0.1916,0.1897,0.1754,0.1659,0.1255,0.1059,0.0684,0.0451],"32":[0.519,0.486,0.4621,0.4333,0.3465,0.2647,0.1821,0.1217]},"hi":{"8":[0.2426,0.2405,0.2249,0.2144,0.1692,0.1469,0.1028,0.0742],"32":[0.5806,0.5478,0.524,0.495,0.4064,0.3209,0.2322,0.165]},"kept":{"8":[0,4,8,16,32,64,128,256],"32":[0,4,8,16,32,64,128,256]},"rho":{"8":[null,-1.7684,-0.8923,-0.4489,-0.2302,-0.1165,-0.0597,-0.0303],"32":[null,-0.8354,-0.7215,-0.5271,-0.4341,-0.3048,-0.243,-0.1226]}},"simH0.03":{"name":"the same simulator, off by 3 %, with hand positions as labels","space":"hand","gap":0.03,"s":{"8":[0.216,0.328,0.379,0.516,0.683,0.821,0.935,0.988],"32":[0.549,0.591,0.615,0.709,0.771,0.859,0.951,0.991]},"lo":{"8":[0.1916,0.2996,0.3494,0.485,0.6535,0.796,0.918,0.9791],"32":[0.518,0.5602,0.5845,0.6801,0.7439,0.8361,0.9358,0.983]},"hi":{"8":[0.2426,0.3577,0.4095,0.5469,0.7111,0.8435,0.9487,0.9931],"32":[0.5796,0.6211,0.6447,0.7363,0.796,0.8792,0.9627,0.9953]},"kept":{"8":[0,4,8,16,32,64,128,256],"32":[0,4,8,16,32,64,128,256]},"rho":{"8":[null,1.7736,1.3,1.2911,1.1997,1.0185,0.9597,0.9271],"32":[null,1.1275,0.8859,1.1196,0.8967,0.8194,0.95,0.8958]}}}},"recover":{"n":[1,2,3,5,10,20,40,80],"calm":{"n":[1,2,3,5,10,20,40,80],"frames":[184,367,551,918,1839,3684,7364,14719],"s":[0.405,0.355,0.495,0.515,0.63,0.635,0.55,0.635],"lo":[0.3394,0.292,0.4265,0.4461,0.5612,0.5663,0.4808,0.5663],"hi":[0.4742,0.4235,0.5637,0.5833,0.6939,0.6986,0.6174,0.6986],"crashed":[0,0,0,0,0,0,0,0]},"g05":{"n":[1,2,3,5,10,20,40,80],"frames":[183,365,549,920,1845,3684,7353,14729],"s":[0.635,0.675,0.665,0.645,0.835,0.815,0.745,0.84],"lo":[0.5663,0.6073,0.597,0.5765,0.7773,0.7554,0.6804,0.7829],"hi":[0.6986,0.7361,0.7268,0.708,0.88,0.8627,0.8004,0.8843],"crashed":[0,0,0,0,0,0,0,0]},"g10":{"n":[1,2,3,5,10,20,40,80],"frames":[184,362,541,914,1845,3683,7350,14696],"s":[0.47,0.79,0.885,0.91,0.955,0.975,0.955,0.955],"lo":[0.402,0.7284,0.8334,0.8622,0.9167,0.9428,0.9167,0.9167],"hi":[0.5391,0.8407,0.9221,0.9423,0.9761,0.9893,0.9761,0.9761],"crashed":[0,0,0,0,0,0,0,1]},"corr":{"rounds":[0,1,2,3,4,5,6],"frames":[3684,4518,5397,6178,7104,8050,8968],"labelled":[0,834,1713,2494,3420,4366,5284],"rollouts":[0,5,10,15,20,25,30],"s":[0.635,0.785,0.87,0.96,0.95,0.95,0.96],"lo":[0.5663,0.723,0.8163,0.9231,0.9104,0.9104,0.9231],"hi":[0.6986,0.8363,0.9097,0.9796,0.9726,0.9726,0.9796]}},"contact":{"m":[1,2,3,5,10,20,40],"clearance":1,"withForce":{"s":[0.825,0.825,0.825,0.825,0.985,0.985,0.985],"lo":[0.7664,0.7664,0.7664,0.7664,0.9568,0.9568,0.9568],"hi":[0.8714,0.8714,0.8714,0.8714,0.9949,0.9949,0.9949],"frames":[38,62,83,136,268,491,984]},"noForce":{"s":[0.515,0.645,0.64,0.665,0.64,0.63,0.63],"lo":[0.4461,0.5765,0.5714,0.597,0.5714,0.5612,0.5612],"hi":[0.5833,0.708,0.7033,0.7268,0.7033,0.6939,0.6939]},"stiff":{"s":0.635,"lo":0.5663,"hi":0.6986},"yielding":{"s":0.985,"lo":0.9568,"hi":0.9949,"timeToInsert":6.2551},"secPerAttempt":6.61},"relevance":{"gen":[0,1,2,3,4,5],"keep":[1,1,1,1,1,1],"keepSuccess":[1,0.9624,1.0083,1.9512,null,null],"keepSmooth":[1,1.2308,1.4076,1.9349,2.3504,3.3311],"valueByGen":[18.4975,9.7865,5.4427,0.8542,1,0.7187],"postsByGen":[38.05,22.55,13.1,5.625,4.225,3.4],"successByGen":[61.95,77.45,86.9,94.375,95.775,96.6],"roundsOnlyByGen":[null,null,96.875,99.75,99.675,99.55],"driftKeep":{"ratio":[1,1.5,2],"keep":[1,0.8041,0.8059],"keepSmooth":[1,0.7552,0.701],"harsher":[1.176,1.1966]},"framesPerRound":823.5,"notes":{"gen":"rounds already stored: 0 is the clone of the 20 calm demonstrations (clone 1 on the page), g is clone g + 1","keep":"share of a correction set's value that survives a retraining of the policy it was made for, as the ledger should book it: 1 (no decay was measured); keepSuccess[k] and keepSmooth[k] are the measured ratios by age k of the set, in clones","keepSuccess":"age k = 1..3: pooled gain of sets made k clones back divided by the pooled gain of fresh sets, clones 2 to 4 (success points, same 200 runs for base and retrained policy); null where not measured (success saturates from clone 4 on)","keepSmooth":"age k = 1..5: mean over the clones that have a set of that age of the ratio of the relative copy-error reductions on the clone's own frames; it rises with age, from 0.9 to 3.3 across cells","valueByGen":"success points that a fresh set of 800 labelled frames (the first 800 frames of eight runs of the clone itself, gust 0.05) adds to the clone of that generation; 4 lineages, pooled draws","postsByGen":"percent of the clone's own runs under gust 0.05 that end in a post (a failure; none times out); 4 x 1000 runs","successByGen":"percent of the clone's runs under gust 0.05 that complete the course","driftKeep":"value of a set made at gust ratio x 0.05 for the clone of the demonstrations, used by a policy that runs at gust 0.05 (ratio 1) / 0.075 / 0.10, relative to a set made at the gust the policy runs at; success points over 100 draws (keep) and copy-error measure (keepSmooth); harsher: sets made at 0.075 and 0.10, used at 0.05","framesPerRound":"labelled frames per round of five runs, mean of the four lineages (one frame is 0.05 s of motion)","dropDemos":"once at least two rounds are stored, success of the clone trained on the corrections alone (roundsOnlyByGen, gen 2 to 5) is higher than that of the clone trained on the 20 calm demonstrations plus the rounds (successByGen): the ledger's recover.corr curve understates what corrections alone reach","scale":"the Bench task is small: shapes, signs and ratios carry to larger tasks; the totals, the gains in points and the dollar figures do not"}}};
/*TABLE:END*/

/* ───────────── reading the table ───────────── */
LG.SOURCES = ['twin', 'old', 'video', 'sim0.001', 'sim0.003', 'sim0.01', 'sim0.03', 'simH0.03'];
LG.name = function (key) { return LG.TABLE.layouts.src[key].name; };
/* the success curve of one foreign source added to `base` own layouts, against hours of the source: {h, s, lo, hi, kept}; the first point (h = 0) is the own baseline */
LG.pooled = function (key, base) {
  var S = LG.TABLE.layouts, o = S.src[key];
  return { h: S.M.map(LG.hours), s: o.s[base], lo: o.lo[base], hi: o.hi[base], kept: o.kept[base], rho: o.rho[base] };
};
/* own-layout curve in hours; space 'hand' (default) or 'joint' */
LG.ownCurve = function (space) {
  var c = space === 'joint' ? LG.TABLE.layouts.ownJoint : LG.TABLE.layouts.ownHand;
  return { h: c.N.map(LG.hours), N: c.N, s: c.s, lo: c.lo, hi: c.hi };
};
/* the own-layout count that would have given success s on the own curve c ({N, s}): the running maximum of the curve, linear in between, the origin below the first
 * point and the last segment extended above the last (this is BL.equivalentOwn of lesson 8, written out so that pages need not load it) */
LG.ownEquivalent = function (c, s) {
  var N = [0].concat(c.N), t = [0], i;
  for (i = 0; i < c.s.length; i++) t.push(Math.max(t[i], c.s[i]));
  if (s <= 0) return 0;
  for (i = 1; i < N.length; i++) if (s <= t[i]) return N[i - 1] + (N[i] - N[i - 1]) * (s - t[i - 1]) / Math.max(1e-12, t[i] - t[i - 1]);
  var a = N.length - 1, sl = (N[a] - N[a - 1]) / Math.max(1e-12, t[a] - t[a - 1]);
  return N[a] + sl * (s - t[a]);
};
/* the exchange rate at an operating point: own-robot hours replaced per hour of the source (dimensionless; 1 = as good as your own, 0 = worthless, negative = harmful) */
LG.rate = function (key, base, i) { return LG.TABLE.layouts.src[key].rho[base][i]; };

/* ───────────── a power law with a floor, fitted to a curve ───────────── */
/* error(h) = A (h + h0)^(-alpha) + floor.  For each floor on a grid below the smallest error, a straight line in log-log through the points above the floor;
 * the floor with the best R^2 wins.  h and err are arrays (h increasing, err > 0); h0 defaults to the smallest positive h.  Returns {A, alpha, floor, h0, r2, n}. */
LG.fitPower = function (h, err, o) {
  o = o || {}; var i, n = h.length, h0 = o.h0 === undefined ? Math.min.apply(null, h.filter(function (x) { return x > 0; })) : o.h0, emin = Math.min.apply(null, err), best = null, f, k;
  var floors = o.floors || []; if (!floors.length) for (k = 0; k <= 40; k++) floors.push(emin * 0.99 * k / 40);
  for (k = 0; k < floors.length; k++) {
    f = floors[k]; var xs = [], ys = [];
    for (i = 0; i < n; i++) if (err[i] - f > 1e-9) { xs.push(Math.log(h[i] + h0)); ys.push(Math.log(err[i] - f)); }
    if (xs.length < 3) continue;
    var mx = 0, my = 0, sxx = 0, sxy = 0, syy = 0, m = xs.length;
    for (i = 0; i < m; i++) { mx += xs[i]; my += ys[i]; } mx /= m; my /= m;
    for (i = 0; i < m; i++) { sxx += (xs[i] - mx) * (xs[i] - mx); sxy += (xs[i] - mx) * (ys[i] - my); syy += (ys[i] - my) * (ys[i] - my); }
    if (sxx < 1e-12 || syy < 1e-12) continue;
    var sl = sxy / sxx, r2 = sxy * sxy / (sxx * syy);
    if (!best || r2 > best.r2) best = { A: Math.exp(my - sl * mx), alpha: -sl, floor: f, h0: h0, r2: r2, n: m };
  }
  return best;
};
LG.powerAt = function (fit, h) { return fit.A * Math.pow(h + fit.h0, -fit.alpha) + fit.floor; };

/* ───────────── prices (assumptions) ───────────── */
LG.assume = {
  wage_per_h: 40,            // $ per hour: an operator or a supervisor, fully loaded
  arm_cost: 18000,           // $ for one robot arm with its cameras and grippers (ALOHA prints $18k)
  arm_life_h: 4000,          // working hours over which the arm is written off
  duty: 0.4,                 // recorded motion time / wall-clock time of a teleoperated session (ALOHA: 17 % to 67 % once resets and mistakes are counted)
  discard: 0.10,             // fraction of attempted demonstrations thrown away as failed or unusable
  force_rig_cost: 15000,     // $ for a force-torque sensor, mount and amplifier (written off over arm_life_h)
  force_duty: 0.25,          // force-bearing insertions are slower and need more resets
  curate_per_h: 15,          // $ per hour of another laboratory's data: download, convert the action space, check
  video_wage_per_h: 25,      // $ per hour of a person filmed doing the task at an ordinary pace
  video_duty: 0.8,           // fraction of filmed time that is task motion
  video_discard: 0.36,       // fraction of footage that cannot be used (the wobblier demonstrator fails more often: lesson 8's engine kept 41 of 64)
  track_per_h: 2,            // $ of compute to track the hand and label one hour of footage
  gpu_per_h: 2.5,            // $ per accelerator hour
  sim_speed: 100,            // simulated seconds per wall-clock second on one accelerator
  scene_weeks: 4,            // engineer weeks to author and validate one simulated scene
  week_cost: 4000,           // $ per engineer week
  scene_uses_h: 100000,      // simulated hours that one scene serves before it is replaced
  calib_h: 2,                // own-robot hours spent measuring the plant so that the simulator can be calibrated
  sup_duty: 0.5              // fraction of a supervisor's wall-clock that is spent correcting
};
LG.copyAssume = function () { var o = {}, k; for (k in LG.assume) o[k] = LG.assume[k]; return o; };
/* dollars per MOTION hour of a source.  key: own, twin, old, video, sim, corr, force.  CAUTION on units: the table's rates are per ATTEMPTED source hour (demonstrations that failed and
 * were thrown away are already inside the rate), so a price that includes a discard share is a price per KEPT hour: for footage, LG.price('video') x (1 - video_discard) is the price of
 * an attempted hour, the one to divide by the table's rate; an own hour is priced per kept hour (the teleoperator's discard share is one of its price lines). */
LG.price = function (key, a) {
  a = a || LG.assume; var arm = a.arm_cost / a.arm_life_h, own = (a.wage_per_h + arm) / (a.duty * (1 - a.discard));
  switch (key) {
    case 'own': return own;
    case 'twin': case 'old': return a.curate_per_h;
    case 'video': return (a.video_wage_per_h + a.track_per_h) / (a.video_duty * (1 - a.video_discard));    // per KEPT hour; per attempted hour multiply by (1 - video_discard)
    case 'sim': return a.gpu_per_h / a.sim_speed + a.scene_weeks * a.week_cost / a.scene_uses_h + a.calib_h * own / a.scene_uses_h;
    case 'corr': return (a.wage_per_h + arm) / a.sup_duty;
    case 'force': return (a.wage_per_h + arm + a.force_rig_cost / a.arm_life_h) / (a.force_duty * (1 - a.discard));
  }
  return NaN;
};
LG.priceKeys = ['own', 'twin', 'old', 'video', 'sim', 'corr', 'force'];

root.LG = LG;
if (typeof module !== 'undefined' && module.exports) module.exports = LG;
})(typeof window !== 'undefined' ? window : globalThis);
