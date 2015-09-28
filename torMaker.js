/******************************************************/
/************ Bootstraps a single TOR PID *************/
/******************************************************/

// Run by bootstrapper.js. I had to split this into a second file because Tor's 'RunAsDaemon' mode doesn't work
// $ curl -v --socks5 localhost:9051 check.torproject.org

var ipc = require(__dirname + '/utils').ipc;

ipc.send({event: "torMakerInit", torMakerPid: process.pid});

var path           = require('path');
var desiredSocks   = parseInt(process.argv[2]);
var torDirectory   = path.resolve(__dirname, "data");
var pidsDirectory  = torDirectory + '/pids/';
var spawn          = require('child_process').spawn;
var exec           = require('child_process').exec;
var config         = require(__dirname + '/config');
var winston        = config.winston;

var makeDefaultDirectories = function (callback) {
  spawn('mkdir', [torDirectory]);
  spawn('mkdir', [pidsDirectory]);
  callback();
}

var bootstrapTor = function() {
  var torName               = 'tor' + desiredSocks;
  var cookieAuthentication  = ' --CookieAuthentication 0';
  var controlPort           = ' --ControlPort 0';
  var hashedControlPassword = ' --HashedControlPassword ""'
  var pidFile               = ' --PidFile ' + pidsDirectory + torName + '.pid'; // data/pids/tor0.pid
  var socksPort             = ' --SocksPort ' + desiredSocks;
  var dataDirectory         = ' --DataDirectory ' + torDirectory + '/' + torName; // data/tor0
  var command = config.torPath + cookieAuthentication + controlPort + hashedControlPassword + pidFile + socksPort + dataDirectory;
  var tor = exec(command);
  winston.info(command);

  var message = { event: "torInit", "pidFile": (pidsDirectory + torName + '.pid'), "socksPort": desiredSocks, "ready": false};
  ipc.send(message);

  tor.stdout.on('data', function (data) {
    if (data.toString().indexOf("Bootstrapped 100%: Done.") !== -1) {
      winston.info('Bootstrapped 100%: Done.');
      message.event = "torLoaded";
      message.ready = true;
      winston.info('ipc.send(message) = ' + JSON.stringify(message));
      ipc.send(message);
    } else {
      winston.info('Bootstrapping tor...please wait...');
      // winston.info(data.toString());
    }
  });

  tor.stderr.on('data', function (data) {
    winston.info('stderr: ' + data);
  });

  tor.on('close', function (code) {
    winston.info('child process exited with code ' + code);
  });
}

makeDefaultDirectories(bootstrapTor);
