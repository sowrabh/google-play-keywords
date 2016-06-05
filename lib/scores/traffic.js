'use strict';

const R = require('ramda');
const calc = require('../calc');

const MAX_KEYWORD_LENGTH = 25;

// weights to merge all stats into a single score
const SUGGEST_W = 8;
const RANKED_W = 3;
const INSTALLS_W = 2;
const LENGTH_W = 1;

function build (store) {
  /*
  * Score the length of the keyword (less traffic is assumed for longer keywords).
  */
  function getKeywordLength (keyword) {
    const length = keyword.length;
    return {
      length,
      score: calc.iScore(1, MAX_KEYWORD_LENGTH, length)
    };
  }

  /*
  * For each of the keyword's top apps, get the ranking for its category and check
  * what rank (if any) it has in that list.
  */
  function getRankedApps (apps) {
    function findRank (list, app) {
      return (list.indexOf(app.appId) + 1) || undefined;
    }

    const queries = R.uniq(apps.map(store.getCollectionQuery));
    const queryIndex = queries.map((q) => [q.collection, q.category]);
    return Promise.all(queries.map(store.list))
      .then(R.map(R.map(R.prop('appId'))))
      .then(R.zipObj(queryIndex))
      .then(function (listMap) {
        // for each app, get its collection/category list and find its rank in there
        const findList = (app) => listMap[[store.getCollection(app), store.getGenre(app)]];
        return apps.map((app) => findRank(findList(app), app));
      })
      .then(R.reject(R.isNil))
      .then(function (results) {
        if (!results.length) {
          return {count: 0, avgRank: undefined, score: 1};
        }

        const stats = {
          count: results.length,
          avgRank: R.sum(results) / results.length
        };

        const countScore = calc.zScore(apps.length, stats.count);
        const avgRankScore = calc.iScore(1, 100, stats.avgRank);
        const score = calc.aggregate([5, 1], [countScore, avgRankScore]);
        return R.assoc('score', score, stats);
      });
  }

  function getScore (stats) {
    return calc.aggregate([SUGGEST_W, LENGTH_W, INSTALLS_W, RANKED_W],
                          [stats.suggest.score, stats.length.score,
                           stats.installs.score, stats.ranked.score]);
  }

  return function (keyword, apps) {
    const topApps = apps.slice(0, 10);
    return Promise.all([
      getRankedApps(topApps),
      store.getSuggestScore(keyword)
    ])
    .then(function (results) {
      const ranked = results[0];
      const suggest = results[1];

      return {
        suggest,
        ranked,
        installs: store.getInstallsScore(topApps),
        length: getKeywordLength(keyword)
      };
    })
    .then((stats) => R.assoc('score', getScore(stats), stats));
  };
}

module.exports = build;
