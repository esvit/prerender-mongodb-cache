var parseUrl = require('url').parse
  , zlib = require('zlib')
  , cache_manager = require('cache-manager')
  , mongo = require('mongodb')
  , MongoClient = require('mongodb').MongoClient
  , mongoUri = process.env.MONGOLAB_URI || process.env.MONGOHQ_URL || 'mongodb://localhost/prerender'
  , statusMatch = /<meta.*?name=['"]prerender-status-code['"] content=['"]([0-9]{3})['"].*?\/?>/i
  , database;

MongoClient.connect(mongoUri, function(err, db) {
  database = db;
});

function bytesToSize(bytes) {
  var k = 1000
    , sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']
    , i;
   if (bytes === 0) return '0 Bytes';
   i = parseInt(Math.floor(Math.log(bytes) / Math.log(k)), 10);
   return (bytes / Math.pow(k, i)).toPrecision(3) + ' ' + sizes[i];
}

function getKeyFromUrl(url) {
  var parsed = parseUrl(url);
  return parsed.host + parsed.path;
}

var mongo_cache = {
  get: function(key, callback) {
    database.collection('pages', function(err, collection) {
      collection.findOne({ _id: key }, function (err, item) {
        if (item && item.value) {
          var buffer = new Buffer(item.value, 'base64');
          zlib.inflate(buffer, function (err, inflated) {
            callback(err, inflated.toString('utf8'));
          });
        } else {
          callback(err, null);
        }
      });
    });
  },
  set: function(key, value, callback) {
    database.collection('pages', function(err, collection) {
      var preSize = bytesToSize(Buffer.byteLength(value, 'utf8'));
      zlib.deflate(value, function (err, deflated) {
        var encoded = deflated.toString('base64');
        var page = {
          _id: key,
          value: encoded,
          created: new Date()
        };
        collection.save(page, { w: 1 }, function (err) {
          if (!err) {
            var postSize = bytesToSize(Buffer.byteLength(encoded, 'base64'));
            console.log('Cached | ' + key + ' | ' + preSize + ' > ' + postSize);
          }
        });
      });
    });
  }
};

module.exports = {
  init: function() {
    this.cache = cache_manager.caching({
        store: mongo_cache
    });
  },
  beforePhantomRequest: function(req, res, next) {
    if (req.method !== 'GET') {
      console.log('Not a GET request.');
      return next();
    }
    this.cache.get(getKeyFromUrl(req.prerender.url), function (err, result) {
      if (!err && result) {
        req.prerender.cache = true;
        res.send(200, result);
      } else {
        req.prerender.cache = false;
        next();
      }
    });
  },
  afterSend: function(req, res) {
    if (!req.prerender.cache && req.prerender.statusCode === 200) {
      this.cache.set(getKeyFromUrl(req.prerender.url), req.prerender.documentHTML);
    }
  }
};
