var targetBucket = 'torlogs'
  , fs           = require('fs')
  , path         = require('path')
  , utils        = require(path.resolve(__dirname, '../utils'))
  , exec         = require('child_process').exec;

var runApp = function (instanceName) {
  var developmentNewFilename = 'development_' + instanceName + "_" + utils.now() + '.log';
  var productionNewFilename  = 'production_'  + instanceName + "_" + utils.now() + '.log';

  var paths = {
    logs: {
        development    : path.resolve(__dirname, '../logs/development.log')
      , developmentCopy: path.resolve(__dirname, '../logs/' + developmentNewFilename)
      , production     : path.resolve(__dirname, '../logs/production.log')
      , productionCopy : path.resolve(__dirname, '../logs/' + productionNewFilename)
    }
  }

  fs.rename(paths.logs.production, paths.logs.productionCopy, function (err) {
    if (err) {
      console.log(err);
    } else {
      fs.readFile(paths.logs.productionCopy, function (err, data) {
        if (err) throw err;
        utils.saveFileToS3({bucket: targetBucket, filename: productionNewFilename, body: data.toString()}, function (err, data) {
          if (err) throw err;
          fs.unlink(paths.logs.productionCopy, function (err) {
            if (err) throw err;
            process.exit(0);
          });
        });
      });      
    }
  });
}

if (process.env.NODE_ENV === "development") {
  runApp('localhost');
} else {
  exec('wget -q -O - http://SERVERIPADDRESS/latest/meta-data/instance-id', function (err, stdout, stderr) {
    if (err)    throw err;
    if (stderr) throw stderr;
    runApp(stdout);
  });
}
