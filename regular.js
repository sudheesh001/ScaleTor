var request   = require('request')
  , urlParser = require('url')
  , fs        = require('fs');

require('http').globalAgent.maxSockets = 100000;

exports.makeRequest = function (url, storageOptions, callback) {
  request(url, function (err, res, body) {
    if (err) {
      var response = { results: null, error: { type: 'regularRequest', message: err }};
      callback(response);
    } else {
      if (res.statusCode >= 300 && res.statusCode < 400) {
        var parsedUrl = urlParser.parse(url);
        var parsedLocation = urlParser.parse(res.headers.location);
        if (parsedLocation.host === null) { // e.g. this is a location redirect that's local
          var newUrl = parsedUrl.protocol + '//' + parsedUrl.host + parsedLocation.path;
        } else {
          var newUrl = res.headers.location;
        }
        exports.makeRequest(newUrl, storageOptions, callback); // Todo: add a 5x check for 302 redirects
      } else { // e.g. 200, all 400s, all 500s
        if (storageOptions.type === 'local') {
          fs.writeFile(storageOptions.directory + storageOptions.filename, body, function (err) {
            if (err) {
              var response = { results: null, error: { type: 'fs', message: err }};  
              callback(response);
            } else {
              var response = { results: { statusCode: res.statusCode, headers: res.headers }, error: null };
              callback(response);
            }
          });          
        } else if (storageOptions.type === 's3') {
          throw ("Implement S3 storage for regular request");
        }
      }
    }
  });
}
