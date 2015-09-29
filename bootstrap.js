var exec    = require('child_process').exec
  , spawn   = require('child_process').spawn
  , path    = require('path')
  , ipc     = require(__dirname + '/utils').ipc // TODO: switch this IPC to zmq
  , app     = require(__dirname + '/app')
  , config  = require(__dirname + '/config')
  , winston = config.winston;

exports.launchTor = function (options) {
  var torMakerPath = path.resolve(__dirname, "torMaker.js");
  var command = config.nodePath + ' ' + torMakerPath + " " +  options.socksPort + ' &';
  
  var torMakerPid;
  var torMaker = exec(command);

  torMaker.stdout.on('data', function (data) {
    ipc.receiveMessage(data, function(message) {
      switch(message.event) {
        case "torMakerInit":
          torMakerPid = message.torMakerPid;
          if (config.verbose === true) winston.info(message);
          break;
        case "torInit":
          if (config.verbose === true) winston.info(message);
          break;
        case "torLoaded":
          app.torLoaded(message);
          if (config.verbose === true) winston.info(message);
          if (config.verbose === true) winston.info("kill -9 on torMaker.js, PID# " + torMakerPid);
          spawn('kill', ['-9', torMakerPid]); // kill the torMaker
          break;
      }
    });

  });

  torMaker.stderr.on('data', function (data) {
    winston.info('stderr: ' + data);
  });

  torMaker.on('close', function (code) {
    if (config.verbose === true) winston.info('torMaker.js process exited with code ' + code);
  });
}



