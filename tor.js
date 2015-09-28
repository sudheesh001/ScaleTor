var config          = require(__dirname + '/config')
  , S3              = config.AWS.S3
  , bootstrap       = require(__dirname + '/bootstrap')
  , utils           = require(__dirname + '/utils')
  , http            = require('socks5-http-client')
  , urlParser       = require('url')
  , knox            = require('knox')
  , zlib            = require('zlib')
  , MultiPartUpload = require('knox-mpu')
  , clone           = require('clone')
  , userAgents      = require(__dirname + '/userAgents')
  , winston         = config.winston;


exports.createHttpOptions = function (socksPort, url) {
  var parsedUrl = urlParser.parse(url);
  var httpOptions = {
      socksPort: socksPort
    , hostname : parsedUrl.host
    , port     : 80
    , headers  : {'user-agent': randomUserAgent()}
    , path     : parsedUrl.path
    , method   : 'GET'
  };
  return httpOptions;
}

var randomUserAgent = function () {
  var minimum = 0;
  var maximum = userAgents.length;
  var random  = (Math.floor(Math.random() * (maximum - minimum + 1)) + minimum);
  return userAgents.list[random];
}

exports.createS3Options = function (bucket, filename) {
  return {bucket: bucket, filename: filename};
}

/////// ANONYMOUS REQUEST WITH GZIP COMPRESSION & S3 STREAMING ///////
// httpOptions = results from createHttpOptions
// s3Options   = results from createS3Options
// callback    = statusCode <int>, headers <JSON>
exports.makeRequestAndStreamGzippedResponseToS3 = function (httpOptions, s3Options, callback) {  
  var knoxClient = knox.createClient({key: config.AWS.key, secret: config.AWS.secret, bucket: s3Options.bucket})
    , gzip       = zlib.createGzip();

  var req = http.request(httpOptions, function(res) {
    if (res.statusCode >= 300 && res.statusCode < 400) {
      var parsedLocation = urlParser.parse(res.headers.location);
      if (parsedLocation.host === null) { // e.g. this is a location redirect that's local
        httpOptions.path = parsedLocation.path;
      } else {
        httpOptions.hostname = parsedLocation.host;
        httpOptions.path     = parsedLocation.path;
      }
      // winston.info("httpOptions after 300 level update = " + JSON.stringify(httpOptions));
      exports.makeRequestAndStreamGzippedResponseToS3(httpOptions, s3Options, callback); // Todo: add a 5x check for 302 redirects
    } else { // e.g. 200, all 400s, all 500s
      var upload = new MultiPartUpload({ // stream gzipped chunks to S3
            client: knoxClient
          , objectName: s3Options.filename
          , headers: { 'Content-Type': 'application/x-gzip' }
          , stream: res.pipe(gzip)
        }, function(s3Error, s3Response) {
          if (s3Error) {
            var response = { results: null, error: { type: 's3', message: s3Error.message }};
            callback(response);
          } else {
            var response = { results: { statusCode: res.statusCode, headers: res.headers }, error: null};
            callback(response);
          }
      });
    }
  });

  req.on('error', function(torError) {
    var response = { results: null, error: { type: 'tor', message: torError.message }};
    callback(response);
  });

  req.end(); // GET request, so end without sending any data.
}